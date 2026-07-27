import { NextResponse } from "next/server";
import { latestJob, toPublicJob } from "@/lib/map-ai-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/ai-job/latest?kind=loop-edit
 * GET /api/map/ai-job/latest?kind=draft&agentId=scout
 *
 * The newest unconsumed job of that kind (running, done, or error) — lets the
 * panel/drawer restore a draft when the owner navigated away and came back.
 * Returns { job: null } when there's nothing to restore.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const agentId = url.searchParams.get("agentId");
  const project = url.searchParams.get("project");

  if (
    kind !== "draft" &&
    kind !== "loop-edit" &&
    kind !== "process-chat" &&
    kind !== "custom-idea" &&
    kind !== "reporter-summary" &&
    kind !== "reporter-refresh" &&
    kind !== "catalog-scan"
  ) {
    return NextResponse.json({ error: "Missing or invalid kind." }, { status: 400 });
  }

  const job = latestJob(kind, (input) => {
    if (agentId && input.agentId !== agentId) return false;
    // Project scope is matched EXACTLY, including "no project on either side"
    // (reporter and catalog jobs are genuinely global, so they ask unscoped and
    // must still be restorable). A job with no project key can only be a
    // leftover from before jobs were scoped — at most an hour old, since jobs
    // expire. Those are dropped rather than assigned to a guessed project:
    // guessing cost one project's draft showing up under another, and the
    // downside here is only that a stale draft has to be re-run.
    if ((input.project ?? null) !== (project ?? null)) return false;
    return true;
  });
  return NextResponse.json({ job: job ? toPublicJob(job) : null });
}
