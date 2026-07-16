import { NextResponse } from "next/server";
import { resolveProject, ProjectError } from "@/lib/projects";
import { startLaunchAnalysisJob, latestLaunchJobForProject } from "@/lib/launcher-jobs";

export const dynamic = "force-dynamic";
// The analysis spawns the local Claude CLI as a child process — Node runtime.
export const runtime = "nodejs";

/**
 * GET /api/launch/analyze?project=<key>
 * The newest analysis job for a project (running or finished) — lets the
 * launch chip re-attach to an analysis the owner walked away from.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("project");
  try {
    const { project } = await resolveProject(key ?? undefined);
    return NextResponse.json({ job: latestLaunchJobForProject(project.key) });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("launch/analyze: latest lookup failed", err);
    return NextResponse.json({ error: "Couldn't check for a running analysis." }, { status: 502 });
  }
}

/**
 * POST /api/launch/analyze  Body: { project }
 * Start a background job in which Claude analyzes the project's local folder
 * and creates its launcher. Returns { jobId } to poll.
 */
export async function POST(req: Request) {
  let body: { project?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const { project } = await resolveProject(body.project);

    // Don't stack a second analysis on top of one that's still running.
    const latest = latestLaunchJobForProject(project.key);
    if (latest && latest.status === "running") {
      return NextResponse.json({ jobId: latest.id });
    }

    const job = startLaunchAnalysisJob(project.key);
    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("launch/analyze: failed", err);
    return NextResponse.json(
      { error: "Couldn't start the analysis. Try again." },
      { status: 502 },
    );
  }
}
