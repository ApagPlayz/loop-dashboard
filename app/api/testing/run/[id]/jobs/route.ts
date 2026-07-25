import { NextResponse } from "next/server";
import { listRunJobs } from "@/lib/testing";
import { resolveProjectFromUrl } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Jobs + step statuses for a single run (live). */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "Bad run id" }, { status: 400 });
  }
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const jobs = await listRunJobs(runId, repo);
    return NextResponse.json({ jobs });
  } catch {
    return NextResponse.json(
      { error: "Could not load this run's jobs." },
      { status: 500 },
    );
  }
}
