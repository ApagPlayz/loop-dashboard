import { NextResponse } from "next/server";
import { getJobLogTail } from "@/lib/testing";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * Tail of a job's logs. Query: ?job=<jobId>&lines=200
 * GitHub only serves logs once a job has finished; while running this returns
 * { available: false } and the UI shows step progress instead.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobId = Number(url.searchParams.get("job"));
  const lines = Number(url.searchParams.get("lines") ?? "200");
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  }
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const result = await getJobLogTail(
      jobId,
      Number.isFinite(lines) ? lines : 200,
      repo,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json(
      { error: "Could not load logs." },
      { status: 500 },
    );
  }
}
