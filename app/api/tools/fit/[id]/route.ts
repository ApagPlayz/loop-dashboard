import { NextResponse } from "next/server";
import { getFitJob } from "@/lib/tool-fit-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/tools/fit/[id] — poll a scan job (progress + result when done). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getFitJob(id);
  if (!job) {
    return NextResponse.json(
      { error: "That scan is gone (scans are kept for one hour). Start a new one." },
      { status: 404 },
    );
  }
  return NextResponse.json({ job });
}
