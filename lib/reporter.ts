/**
 * Reporter orchestration: turn the raw per-source pulls into one deduped,
 * newest-first digest, merge it with what we already had cached, and persist it.
 *
 * - getDigest():     the cached digest. On a cold cache (a fresh serverless
 *                    instance always starts cold — see lib/reporter-store.ts) it
 *                    builds a fast, best-effort one: time-budgeted source pull,
 *                    no AI enrichment. A live request never waits on the full job.
 * - refreshDigest(): the full job — every source, no budget, plus enrichment.
 *                    This is what the 6-hourly cron and "Refresh now" run, and
 *                    what fills in the insights a cold build skipped.
 */

import type { Digest, DigestItem } from "./reporter-types";
import { pullAllSources, canonicalUrl } from "./reporter-sources";
import { enrichDigest } from "./reporter-enrich";
import { loadCache, saveCache } from "./reporter-store";

const MAX_ITEMS = 200;

/**
 * A digest plus one marker the serving layer needs.
 *
 * `partial` means "this digest is still missing things a full refresh would
 * have given it" — most importantly the AI-derived insights. It is persisted
 * with the digest, so an incomplete build still reads as partial across
 * requests and instances. GET /api/reporter uses it to kick off the full
 * refresh straight away instead of waiting for `lastUpdated` to go stale (any
 * build stamps `lastUpdated` = now, so the staleness check alone would never
 * fire).
 *
 * It records what the build ACHIEVED, not what it was asked to do. Recording
 * the requested mode meant a full refresh run while the AI backend was down
 * produced zero insights and still stamped `partial: false` — which read as
 * "complete", so nothing tried again for six hours and the digest sat there
 * permanently insight-less.
 */
export type ServedDigest = Digest & { readonly partial?: boolean };

/**
 * How long a cold-start build may spend pulling sources before it gives up on
 * the stragglers and answers with what it has. Well inside a serverless
 * function's budget; the next full refresh picks up whatever was skipped.
 */
const COLD_PULL_BUDGET_MS = 8000;

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
    // Preserve the AI-distilled insight across refreshes — enrichment is
    // expensive, so a fresh pull that hasn't been enriched yet keeps the
    // insight we already derived rather than dropping it.
    if (!it.insight && prev.insight) merged.insight = prev.insight;
    byKey.set(key, merged);
  }
  return [...byKey.values()].sort((a, b) => b.sortTs - a.sortTs).slice(0, MAX_ITEMS);
}

/**
 * Drop the transient raw discussion text. `enrichDigest` does this itself; this
 * is the fallback for the paths that skip it — it must never reach the cache.
 */
function stripDiscussion(items: DigestItem[]): DigestItem[] {
  for (const it of items) delete it.discussion;
  return items;
}

/**
 * The cached digest. If nothing is cached yet, build one cheaply rather than
 * running the full job on a live request: pull with a time budget and skip AI
 * enrichment. Insights arrive on the next full refresh (the merge keeps them
 * from then on), so the only cost of a cold answer is temporarily missing
 * insights and any source too slow for the budget.
 */
export async function getDigest(): Promise<ServedDigest> {
  const cache = loadCache();
  if (cache.digest) return cache.digest;
  return buildDigest({ budgetMs: COLD_PULL_BUDGET_MS, enrich: false });
}

/** Whether we already have a cached digest (so the page can avoid blocking). */
export function hasCachedDigest(): boolean {
  return loadCache().digest !== null;
}

/** Re-pull every source, merge with cache, persist, and return the digest. */
export async function refreshDigest(): Promise<Digest> {
  return buildDigest({ enrich: true });
}

/** Items that carry raw discussion but no insight yet — enrichment's input. */
function countEnrichable(items: DigestItem[]): number {
  return items.filter(
    (it) => Array.isArray(it.discussion) && it.discussion.length > 0 && !it.insight,
  ).length;
}

function countInsights(items: DigestItem[]): number {
  return items.filter((it) => it.insight).length;
}

/** Pull → merge → (optionally) enrich → persist. Shared by both entry points. */
async function buildDigest({
  budgetMs,
  enrich,
}: {
  budgetMs?: number;
  enrich: boolean;
}): Promise<ServedDigest> {
  const cache = loadCache();
  const { items: fresh, sources } = await pullAllSources({ budgetMs });
  const merged = mergeItems(cache.digest?.items ?? [], fresh);

  // Measure BEFORE enriching: `enrichDigest` both mutates the items in place
  // and clears `discussion`, so afterwards there is nothing left to count.
  const enrichable = enrich ? countEnrichable(merged) : 0;
  const insightsBefore = enrich ? countInsights(merged) : 0;

  // Enrich community items (derive `insight` from raw discussion, clear it).
  // A failure here must never sink the refresh — fall back to the un-enriched
  // merge so the digest still updates.
  let items: DigestItem[];
  let enrichFailed = false;
  if (enrich) {
    try {
      items = await enrichDigest(merged);
    } catch (e) {
      console.error("reporter: enrichDigest failed, using un-enriched merge", e);
      enrichFailed = true;
      items = stripDiscussion(merged);
    }
  } else {
    items = stripDiscussion(merged);
  }

  // `enrichDigest` swallows its own failures (a disabled AI backend, a timed-out
  // batch) and simply returns the items unchanged, so "it didn't throw" says
  // nothing about whether it worked. The honest signal is the outcome: there
  // was work to do and no insight came back.
  const enrichmentAchievedNothing =
    enrich && !enrichFailed && enrichable > 0 && countInsights(items) === insightsBefore;

  const digest: ServedDigest = {
    items,
    lastUpdated: new Date().toISOString(),
    sources,
    partial: !enrich || enrichFailed || enrichmentAchievedNothing,
  };
  saveCache({ digest });
  return digest;
}
