import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { runSharedRefresh } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Constant-time token comparison. Both sides are hashed first so the compare
 * is over two fixed-width digests — `timingSafeEqual` throws on a length
 * mismatch, and the length of the presented token shouldn't leak anyway.
 */
function tokensMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * GET /api/reporter/cron — scheduled trigger (Vercel Cron; see vercel.json).
 *
 * Runs the same `refreshDigest()` the manual "Refresh now" button and the
 * stale-on-load check in `../route.ts` use, through the shared single-flight
 * guard (`runSharedRefresh`) so a cron tick can't stack a second pull on top
 * of one already running.
 *
 * `CRON_SECRET` is REQUIRED and the endpoint fails closed without it — a
 * refresh fans out to GitHub and, on the API backend, to a paid model, so it
 * must never be triggerable by anyone who happens to know the URL. The caller
 * presents it as `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron and
 * EventBridge Scheduler both send). The old `?token=` query-param fallback is
 * gone: secrets in query strings end up in access logs.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "reporter: CRON_SECRET is not set — refusing to run the scheduled refresh.",
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET is not set on the server, so the scheduled refresh is disabled.",
      },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearer || !tokensMatch(bearer, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
