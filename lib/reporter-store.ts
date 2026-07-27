/**
 * File-backed cache for the Reporter digest.
 *
 * Mirrors the tmp-dir persistence pattern used by lib/map-ai-jobs.ts: locally the
 * server is one long-lived Node process, so we keep the digest in memory AND
 * write it to a single JSON file under os.tmpdir() as a safety net across
 * request contexts and dev-server reloads. This lets the tab load instantly
 * from cache while "Refresh now" re-pulls the sources in the background.
 *
 * On serverless (Vercel) this is best-effort only, and deliberately so:
 * os.tmpdir() is per-instance scratch space, not shared storage. Every cold
 * start begins with an empty cache, a warm instance keeps its copy only until
 * it's recycled, and two concurrent instances never see each other's writes.
 * Nothing may depend on a hit — a miss just means a rebuild, which is why
 * lib/reporter.ts builds cold under a time budget and without AI enrichment,
 * and why the 6-hourly cron re-warms whichever instance it lands on. A cache
 * that genuinely survives would need a real store (KV/blob), not this file.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Digest } from "./reporter-types";

export type ReporterCache = {
  digest: Digest | null;
};

const EMPTY: ReporterCache = { digest: null };

let mem: ReporterCache | undefined; // undefined = not loaded from disk yet

function cacheDir(): string {
  const dir = path.join(tmpdir(), "loop-dashboard-reporter");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return dir;
}

function cacheFile(): string {
  return path.join(cacheDir(), "digest.json");
}

/**
 * Load the cache (memory first, then disk). Never throws.
 *
 * Only `digest` is read, so a file written by an older build (which also stored
 * a dead `checkpoints` map) loads fine — the extra key is simply ignored and
 * dropped on the next save.
 */
export function loadCache(): ReporterCache {
  if (mem) return mem;
  try {
    const raw = readFileSync(cacheFile(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<ReporterCache>;
    mem = { digest: parsed.digest ?? null };
  } catch {
    mem = { ...EMPTY };
  }
  return mem;
}

/** Persist the cache to memory and disk. Never throws. */
export function saveCache(cache: ReporterCache): void {
  mem = cache;
  try {
    writeFileSync(cacheFile(), JSON.stringify(cache), "utf-8");
  } catch (err) {
    console.warn("reporter-store: persist failed", err);
  }
}
