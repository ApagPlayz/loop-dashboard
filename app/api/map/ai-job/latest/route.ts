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

  if (kind !== "draft" && kind !== "loop-edit") {
    return NextResponse.json({ error: "Missing or invalid kind." }, { status: 400 });
  }

  const job = latestJob(kind, agentId ? (input) => input.agentId === agentId : undefined);
  return NextResponse.json({ job: job ? toPublicJob(job) : null });
}
