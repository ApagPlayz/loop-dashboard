import { NextResponse } from "next/server";
import { getLaunchJob } from "@/lib/launcher-jobs";
import { isLocalModeEnabled, localModeDisabledResponse } from "@/lib/local-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/launch/analyze/[id] — poll an analysis job.
 * LOCAL-ONLY: 404s unless LOOP_DASHBOARD_LOCAL_MODE is on.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isLocalModeEnabled()) return localModeDisabledResponse();

  const { id } = await ctx.params;
  const job = getLaunchJob(id);
  if (!job) {
    return NextResponse.json(
      { error: "That analysis is gone (they're kept for one hour). Start a new one." },
      { status: 404 },
    );
  }
  return NextResponse.json({ job });
}
