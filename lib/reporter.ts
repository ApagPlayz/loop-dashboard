/**
 * Reporter orchestration: turn the raw per-source pulls into one deduped,
 * newest-first digest, merge it with what we already had cached, and persist
 * the result plus per-source last-seen checkpoints.
 *
 * - getDigest():   cached digest (builds once on first ever call).
 * - refreshDigest(): re-pull all sources, merge, persist, return fresh digest.
 */

import type { Digest, DigestItem } from "./reporter-types";
import { pullAllSources, canonicalUrl } from "./reporter-sources";
import { loadCache, saveCache } from "./reporter-store";

const MAX_ITEMS = 200;

/** Dedupe key: releases collapse by version; everything else by canonical URL. */
function dedupeKey(it: DigestItem): string {
  if (it.category === "code-release") {
    const v = it.title.match(/\d+\.\d+\.\d+/)?.[0];
    if (v) return `release:${v}`;
  }
  return `url:${canonicalUrl(it.url)}`;
}

/** Merge two item lists, preferring the entry that carries a real date. */
function mergeItems(older: DigestItem[], newer: DigestItem[]): DigestItem[] {
  const byKey = new Map<string, DigestItem>();
  // Seed with older, then let newer overwrite — but keep a date if the newer
  // one lost it (e.g. a release that later dropped its pinned changelog stub).
  for (const it of older) byKey.set(dedupeKey(it), it);
  for (const it of newer) {
    const key = dedupeKey(it);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, it);
      continue;
    }
    // Prefer dated over dateless; otherwise the fresher pull wins.
    const merged: DigestItem = { ...prev, ...it };
    if (!it.date && prev.date) {
      merged.date = prev.date;
      merged.sortTs = it.pinned ? it.sortTs : prev.sortTs;
    }
    if (!it.summary && prev.summary) merged.summary = prev.summary;
    byKey.set(key, merged);
  }
  return [...byKey.values()].sort((a, b) => b.sortTs - a.sortTs).slice(0, MAX_ITEMS);
}

/** Newest date seen per source, for the persisted checkpoints. */
function computeCheckpoints(items: DigestItem[]): Record<string, string> {
  const cp: Record<string, string> = {};
  for (const it of items) {
    if (!it.date) continue;
    const cur = cp[it.sourceKey];
    if (!cur || it.date > cur) cp[it.sourceKey] = it.date;
  }
  return cp;
}

/** Cached digest. Builds once (blocking) if nothing has been pulled yet. */
export async function getDigest(): Promise<Digest> {
  const cache = loadCache();
  if (cache.digest) return cache.digest;
  return refreshDigest();
}

/** Whether we already have a cached digest (so the page can avoid blocking). */
export function hasCachedDigest(): boolean {
  return loadCache().digest !== null;
}

/** Re-pull every source, merge with cache, persist, and return the digest. */
export async function refreshDigest(): Promise<Digest> {
  const cache = loadCache();
  const { items: fresh, sources } = await pullAllSources();
  const merged = mergeItems(cache.digest?.items ?? [], fresh);
  const digest: Digest = {
    items: merged,
    lastUpdated: new Date().toISOString(),
    sources,
  };
  saveCache({ digest, checkpoints: computeCheckpoints(merged) });
  return digest;
}
