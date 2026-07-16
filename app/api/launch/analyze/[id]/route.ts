import { NextResponse } from "next/server";
import { getLaunchJob } from "@/lib/launcher-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/launch/analyze/[id] — poll an analysis job. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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
