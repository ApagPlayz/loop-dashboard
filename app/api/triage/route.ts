import { NextResponse } from "next/server";

import { ProjectError, resolveProject } from "@/lib/projects";
import { aiEnabled } from "@/lib/map-ai";
import { latestTriageJobForProject, startTriageJob } from "@/lib/triage-jobs";

export const dynamic = "force-dynamic";
// The CLI backend spawns `claude` as a child process — Node runtime, not Edge.
export const runtime = "nodejs";

/**
 * The backlog-triage agent (lib/agent/) driven from the Ideas screen.
 *
 * OWNER ONLY. There is deliberately no demo fixture for these paths, so
 * proxy.ts refuses an anonymous caller with a 403 before the handler runs — see
 * lib/public-access.ts. That matters more here than on most routes: POST spends
 * real money on a model, and the resume step can write to a private repo.
 *
 * The pair of routes exists because the graph HALTS. A run is
 *   POST /api/triage                     -> { jobId }, graph starts
 *   GET  /api/triage/[id]  (polled)      -> status, then the proposals
 *   POST /api/triage/[id]/decisions      -> resumes the paused graph
 * and the paused graph itself lives in lib/triage-jobs.ts between the calls.
 */

/** Never pull more than this in one run: every issue is model input. */
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;

function clampLimit(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * GET /api/triage?project=<key>
 * The newest triage run for a project, or null. Lets the panel re-attach to a
 * run the owner walked away from — including one still parked at the interrupt.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const { project } = await resolveProject(url.searchParams.get("project") ?? undefined);
    return NextResponse.json({ job: latestTriageJobForProject(project.key) });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("triage: latest lookup failed", err);
    return NextResponse.json({ error: "Couldn't check for a triage run." }, { status: 502 });
  }
}

/**
 * POST /api/triage  Body: { project?, limit? }
 * Start a run. Returns { jobId } to poll. Dry run — `startTriageJob` hardcodes
 * `apply: false`, and writes are opted into later, at the decisions step.
 */
export async function POST(req: Request) {
  if (!aiEnabled()) {
    return NextResponse.json(
      {
        error:
          "No AI backend is configured, so the triage agent can't assess anything. Set DASHBOARD_AI_BACKEND (or install the Claude CLI).",
      },
      { status: 503 },
    );
  }

  let body: { project?: string; limit?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const { project, repo } = await resolveProject(body.project);

    // Don't stack a second run on top of one that is still working or still
    // parked at the interrupt — two paused graphs over the same backlog is a
    // way to apply the same decision twice.
    const latest = latestTriageJobForProject(project.key);
    if (latest && (latest.status === "running" || latest.status === "awaiting-decisions")) {
      return NextResponse.json({ jobId: latest.id });
    }

    const job = startTriageJob({
      projectKey: project.key,
      repo,
      limit: clampLimit(body.limit),
    });
    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("triage: start failed", err);
    return NextResponse.json({ error: "Couldn't start the triage run." }, { status: 502 });
  }
}
