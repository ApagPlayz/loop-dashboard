import { NextResponse } from "next/server";
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

/** Fire-and-forget: kick off (or join) the shared refresh, never throws. */
export function triggerBackgroundRefresh(reason: string): void {
  runSharedRefresh().catch((e) => {
    console.error(`reporter: background refresh (${reason}) failed`, e);
  });
}

/** GET /api/reporter — the cached digest (builds once if empty). */
export async function GET() {
  try {
    const digest = await getDigest();

    const ageMs = Date.now() - Date.parse(digest.lastUpdated);
    if (!Number.isFinite(ageMs) || ageMs > STALE_MS) {
      // Fire-and-forget: never block the response on a fresh pull.
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
