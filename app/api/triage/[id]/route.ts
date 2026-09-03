import { NextResponse } from "next/server";

import { getTriageJob } from "@/lib/triage-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/triage/[id] — poll one triage run.
 *
 * `status` walks running -> awaiting-decisions -> applying -> done. The panel
 * stops polling at `awaiting-decisions`, because from there the next move is the
 * owner's, not the agent's: the graph is parked in the checkpointer and will
 * stay parked until someone POSTs decisions.
 *
 * OWNER ONLY — no demo fixture, so anonymous callers get a 403 from the proxy.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getTriageJob(id);
  if (!job) {
    return NextResponse.json(
      {
        error:
          "That triage run is gone (runs are kept for an hour, and don't survive a dashboard restart). Start a new one.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json({ job });
}
