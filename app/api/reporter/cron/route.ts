import { NextRequest, NextResponse } from "next/server";
import { runSharedRefresh } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/reporter/cron — scheduled trigger (Vercel Cron; see vercel.json).
 *
 * Runs the same `refreshDigest()` the manual "Refresh now" button and the
 * stale-on-load check in `../route.ts` use, through the shared single-flight
 * guard (`runSharedRefresh`) so a cron tick can't stack a second pull on top
 * of one already running.
 *
 * Protected by `CRON_SECRET` when set: Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`; a `?token=` query param is accepted
 * as a fallback for manual/GitHub-Actions style triggering. If `CRON_SECRET`
 * is unset, the endpoint is open (so local dev works without configuring
 * anything).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const tokenParam = request.nextUrl.searchParams.get("token");
    if (bearer !== secret && tokenParam !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const digest = await runSharedRefresh();
    return NextResponse.json({
      ok: true,
      itemCount: digest.items.length,
      lastUpdated: digest.lastUpdated,
    });
  } catch (e) {
    console.error("reporter: cron refresh failed", e);
    return NextResponse.json(
      { ok: false, error: "The scheduled refresh didn't complete." },
      { status: 502 },
    );
  }
}
