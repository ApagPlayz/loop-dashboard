import { NextResponse } from "next/server";
import { readCache } from "@/lib/tool-fit";
import { startFitJob, latestFitJobForRepo } from "@/lib/tool-fit-jobs";

export const dynamic = "force-dynamic";
// The scan spawns the local Claude CLI as a child process — Node runtime.
export const runtime = "nodejs";

function parseRepo(input: string): { owner: string; repo: string } | null {
  const cleaned = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  const m = cleaned.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/**
 * GET /api/tools/fit?owner=&repo=
 * Restore state for a repo when the panel mounts: any cached result plus a
 * running/finished job (so a scan the owner walked away from can be picked up).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const owner = url.searchParams.get("owner") ?? "";
  const repo = url.searchParams.get("repo") ?? "";
  if (!owner || !repo) {
    return NextResponse.json({ error: "Pick a repository first." }, { status: 400 });
  }
  const cached = readCache(owner, repo);
  const job = latestFitJobForRepo(owner, repo);
  return NextResponse.json({ cached, job: job ?? null });
}

/**
 * POST /api/tools/fit  Body: { owner, repo } OR { fullName } (owner/repo), plus
 * optional { rescan }. Returns a cached result instantly when one exists and no
 * re-scan was asked for; otherwise starts a background job and returns its id.
 */
export async function POST(req: Request) {
  let body: { owner?: string; repo?: string; fullName?: string; rescan?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let owner = (body.owner ?? "").trim();
  let repo = (body.repo ?? "").trim();
  if ((!owner || !repo) && body.fullName) {
    const parsed = parseRepo(body.fullName);
    if (parsed) ({ owner, repo } = parsed);
  }
  if (!owner || !repo) {
    return NextResponse.json(
      { error: "Enter a repository as owner/name (for example ApagPlayz/loop-dashboard)." },
      { status: 400 },
    );
  }

  if (!body.rescan) {
    const cached = readCache(owner, repo);
    if (cached) return NextResponse.json({ cached: true, result: cached });
  }

  const job = startFitJob(owner, repo);
  return NextResponse.json({ jobId: job.id });
}
