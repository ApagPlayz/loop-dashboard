/**
 * File-backed cache for the Reporter digest.
 *
 * Mirrors the tmp-dir persistence pattern used by lib/map-ai-jobs.ts: the local
 * server is one long-lived Node process, so we keep the digest in memory AND
 * write it to a single JSON file under os.tmpdir() as a safety net across
 * request contexts and dev-server reloads. This lets the tab load instantly
 * from cache while "Refresh now" re-pulls the sources in the background.
 *
 * Alongside the digest we persist per-source "last-seen" checkpoints (the newest
 * date observed per source) so incremental pulls can tell what is genuinely new.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Digest } from "./reporter-types";

export type ReporterCache = {
  digest: Digest | null;
  /** sourceKey -> ISO date of the newest item seen from that source. */
  checkpoints: Record<string, string>;
};

const EMPTY: ReporterCache = { digest: null, checkpoints: {} };

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

/** Load the cache (memory first, then disk). Never throws. */
export function loadCache(): ReporterCache {
  if (mem) return mem;
  try {
    const raw = readFileSync(cacheFile(), "utf-8");
    const parsed = JSON.parse(raw) as ReporterCache;
    mem = {
      digest: parsed.digest ?? null,
      checkpoints: parsed.checkpoints ?? {},
    };
  } catch {
    mem = { ...EMPTY, checkpoints: {} };
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
