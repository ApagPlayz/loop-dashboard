import { after, NextResponse } from "next/server";
import { getDigest, refreshDigest } from "@/lib/reporter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How old `digest.lastUpdated` can get before a GET triggers a background pull. */
const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Single-flight guard shared with the cron route (see `./cron/route.ts`) so a
 * stale-on-load trigger here and a scheduled Vercel Cron hit never stack two
 * concurrent `refreshDigest()` runs — both call sites route through the same
 * in-flight promise. Module state, so it only dedupes within one warm server
 * instance — harmless if a cold start races it, since `refreshDigest()` is
 * just a re-pull + persist, not destructive.
 */
let refreshPromise: ReturnType<typeof refreshDigest> | null = null;

/** Start (or join) the shared refresh. Callers decide whether to await it. */
export function runSharedRefresh(): ReturnType<typeof refreshDigest> {
  if (!refreshPromise) {
    refreshPromise = refreshDigest().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Fire-and-forget: kick off (or join) the shared refresh, never throws.
 *
 * Scheduled through `after()` so the pull keeps running once the response has
 * been sent — on serverless a bare floating promise can be frozen the instant
 * the JSON goes out, which would leave the refresh half-done. Must therefore
 * only be called from inside a request (it is: the GET below is the only
 * caller; the cron route awaits `runSharedRefresh` directly).
 */
export function triggerBackgroundRefresh(reason: string): void {
  after(() =>
    runSharedRefresh().catch((e) => {
      console.error(`reporter: background refresh (${reason}) failed`, e);
    }),
  );
}

/** GET /api/reporter — the cached digest (builds once if empty). */
export async function GET() {
  try {
    const digest = await getDigest();

    const ageMs = Date.now() - Date.parse(digest.lastUpdated);
    // A cold-built digest is partial (budgeted pull, no enrichment) yet stamps
    // `lastUpdated` = now, so the staleness check below can never catch it —
    // it would look current for the next 6 hours while its insights are still
    // missing. Trigger the full refresh straight away instead. `else if` so a
    // digest only ever schedules one refresh, and a complete digest still goes
    // purely by age. Both branches share the single-flight guard above, so a
    // concurrent cold build / cron tick joins the same run rather than stacking.
    if (digest.partial) {
      // Fire-and-forget: never block the response on a fresh pull.
      triggerBackgroundRefresh("partial-on-load");
    } else if (!Number.isFinite(ageMs) || ageMs > STALE_MS) {
      triggerBackgroundRefresh("stale-on-load");
    }

    return NextResponse.json({ digest });
  } catch (e) {
    console.error("reporter: GET failed", e);
    return NextResponse.json(
      { error: "Couldn't load the news digest. Try refreshing." },
      { status: 502 },
    );
  }
}
