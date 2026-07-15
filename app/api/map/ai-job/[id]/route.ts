import { NextResponse } from "next/server";
import { getJob, consumeJob, toPublicJob } from "@/lib/map-ai-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/map/ai-job/[id] — poll a drafting job. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json(
      { error: "That draft is gone (drafts are kept for one hour). Start a new one." },
      { status: 404 },
    );
  }
  return NextResponse.json({ job: toPublicJob(job) });
}

/** POST /api/map/ai-job/[id] — mark the job consumed (applied or discarded). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!consumeJob(id)) {
    return NextResponse.json({ error: "Unknown draft." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
