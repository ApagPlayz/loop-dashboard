/**
 * Where AI usage records actually live once the process that made them is gone.
 *
 * lib/ai-usage.ts keeps a bounded ring in memory, which is what /api/usage
 * reads. That ring is worth exactly one process: a Vercel lambda that goes cold
 * or an ECS task that gets replaced takes the whole month's accounting with it.
 * So every record is also appended to a JSONL file.
 *
 * ## Layout, and why the local file is primary here
 *
 * lib/dedup/artifact-store.ts makes S3 primary and the local file the fallback,
 * because ML artifacts are large, shared, and read far more often than written.
 * Usage records are the opposite: tiny, written one at a time on the request
 * path, and read by one person. So the polarity is flipped —
 *
 *   USAGE_STORE=local  (default) — append to data/ai-usage.jsonl, nothing else
 *   USAGE_STORE=s3               — the same local append, PLUS an S3 mirror
 *   USAGE_STORE=off              — record nothing durably (tests, and an opt-out)
 *
 * — and S3 is a *mirror*, never the primary. A blocked or slow S3 call must not
 * be able to delay a draft, and losing the network must not lose the record.
 *
 * The file lives under `data/`, the same repo-root directory artifact-store.ts
 * points its local paths at. Deliberately NOT os.tmpdir(): a container's temp
 * directory is wiped on every deploy, which would make "durable" a lie.
 *
 * ## Everything here is non-fatal
 *
 * `appendUsage` never rejects. A telemetry write that can fail a real AI call
 * is worse than no telemetry at all.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { artifactBucket, artifactRegion, putObjectText } from "./dedup/artifact-store";
import type { AiUsageRecord } from "./ai-usage";

export type UsageStoreMode = "local" | "s3" | "off";

/** Repo root, matching artifact-store.ts's convention. */
const ROOT = path.resolve(process.cwd());

/** Default local path, relative to the repo root. */
export const DEFAULT_USAGE_PATH = "data/ai-usage.jsonl";

/**
 * Rotate at 2 MB. At ~250 bytes a record that is on the order of 8,000 calls —
 * months of the owner's use — and it bounds the file at 4 MB total (current
 * plus one rolled generation), which is small enough to keep in a container's
 * writable layer without thinking about it.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/** Which store to use. Unknown values fall back to `local` rather than throwing:
 * this module runs on the request path and a typo in an env var must not be
 * able to take AI drafting down with it. */
export function usageStoreMode(): UsageStoreMode {
  const pref = (process.env.USAGE_STORE ?? "local").trim().toLowerCase();
  if (pref === "s3") return "s3";
  if (pref === "off" || pref === "none") return "off";
  if (pref === "local" || pref === "") return "local";
  console.warn(`[usage-store] unknown USAGE_STORE="${pref}"; using local.`);
  return "local";
}

/** Absolute path of the JSONL file. USAGE_STORE_PATH overrides it (tests, ECS volumes). */
export function usageFilePath(): string {
  const override = process.env.USAGE_STORE_PATH;
  if (override) return path.isAbsolute(override) ? override : path.join(ROOT, override);
  return path.join(ROOT, DEFAULT_USAGE_PATH);
}

/** Bucket for the mirror. Shares the ML bucket by default — same account, same lifecycle. */
export function usageBucket(): string {
  return process.env.USAGE_STORE_BUCKET || artifactBucket();
}

/* ------------------------------------------------------------------ */
/* Local append                                                        */
/* ------------------------------------------------------------------ */

/**
 * Appends are serialised through this promise chain. Two concurrent AI calls
 * finishing together would otherwise race on the rotate-then-append sequence
 * and one of them could write into a file that is about to be renamed.
 */
let writeChain: Promise<void> = Promise.resolve();

/**
 * Roll the file over when it passes MAX_BYTES. One generation is kept
 * (`ai-usage.1.jsonl`, overwritten each time) — enough that a rotation right
 * after a burst does not immediately lose that burst, without inventing a
 * retention policy nobody asked for.
 */
async function rotateIfNeeded(file: string): Promise<void> {
  let size: number;
  try {
    size = (await fs.stat(file)).size;
  } catch {
    return; // no file yet — nothing to rotate
  }
  if (size < MAX_BYTES) return;

  const rolled = file.replace(/\.jsonl$/, "") + ".1.jsonl";
  try {
    await fs.rename(file, rolled);
  } catch (err) {
    console.warn(`[usage-store] could not rotate ${file}`, err);
  }
}

async function appendLocal(line: string): Promise<void> {
  const file = usageFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await rotateIfNeeded(file);
  await fs.appendFile(file, line, "utf-8");
}

/* ------------------------------------------------------------------ */
/* S3 mirror                                                           */
/* ------------------------------------------------------------------ */

/**
 * Key for one record's mirror copy.
 *
 * S3 has no append, so the mirror is one small immutable object per call under
 * a date partition rather than a read-modify-write of a single key — which
 * would drop records whenever two calls finished at once, and is the classic
 * way a usage log quietly under-counts. The volume this dashboard produces
 * (tens of calls a day) makes a PUT per record a rounding error; if that ever
 * stops being true, batch here rather than sharing one key.
 */
function mirrorKey(record: AiUsageRecord): string {
  const day = (record.ts || new Date().toISOString()).slice(0, 10);
  const suffix = Math.random().toString(36).slice(2, 10);
  return `ai-usage/${day}/${Date.parse(record.ts) || Date.now()}-${suffix}.jsonl`;
}

async function mirrorToS3(record: AiUsageRecord, line: string): Promise<void> {
  await putObjectText(mirrorKey(record), line, "application/x-ndjson", usageBucket());
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Append one record durably. Never rejects and never throws.
 *
 * Callers are expected to `void` this rather than await it — see
 * `recordUsage` in lib/ai-usage.ts. The returned promise exists so tests (and
 * anything that genuinely wants to flush) can wait for the write.
 */
export async function appendUsage(record: AiUsageRecord): Promise<void> {
  const mode = usageStoreMode();
  if (mode === "off") return;

  let line: string;
  try {
    line = JSON.stringify(record) + "\n";
  } catch (err) {
    console.warn("[usage-store] record is not serialisable; dropping it", err);
    return;
  }

  const work = writeChain.then(async () => {
    try {
      await appendLocal(line);
    } catch (err) {
      console.warn(`[usage-store] could not append to ${usageFilePath()}`, err);
    }
    if (mode !== "s3") return;
    try {
      await mirrorToS3(record, line);
    } catch (err) {
      // The local file already has it; the mirror is best-effort.
      console.warn(
        `[usage-store] S3 mirror to s3://${usageBucket()} (${artifactRegion()}) failed`,
        (err as { message?: string })?.message ?? err,
      );
    }
  });

  // Keep the chain alive even if something above escapes the try blocks.
  writeChain = work.catch(() => {});
  return writeChain;
}

/**
 * Read records back out of the local file, oldest first. Skips malformed lines
 * rather than throwing: a half-written final line (process killed mid-append)
 * must not make the whole history unreadable.
 *
 * Returns [] when the file does not exist — "no calls recorded yet" and "no
 * file" are the same answer.
 */
export async function readUsageRecords(limit?: number): Promise<AiUsageRecord[]> {
  let text: string;
  try {
    text = await fs.readFile(usageFilePath(), "utf-8");
  } catch {
    return [];
  }

  const out: AiUsageRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as AiUsageRecord);
    } catch {
      // Truncated or corrupt line — skip it.
    }
  }
  if (limit && limit > 0 && out.length > limit) return out.slice(out.length - limit);
  return out;
}

/** Wait for every queued append to settle. Tests only. */
export async function flushUsageWrites(): Promise<void> {
  await writeChain;
}
