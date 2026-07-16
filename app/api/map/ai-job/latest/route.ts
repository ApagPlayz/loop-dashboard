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
    kind !== "custom-idea"
  ) {
    return NextResponse.json({ error: "Missing or invalid kind." }, { status: 400 });
  }

  const job = latestJob(kind, (input) => {
    if (agentId && input.agentId !== agentId) return false;
    // Jobs created before projects existed have no project field — treat as pilot.
    if (project && (input.project ?? "content-generation-platform") !== project) return false;
    return true;
  });
  return NextResponse.json({ job: job ? toPublicJob(job) : null });
}
