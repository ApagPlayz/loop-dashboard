import { NextResponse } from "next/server";
import type { RepoConfig } from "@/lib/github";
import { installBaselineLoop, OnboardError } from "@/lib/onboard";
import { ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/map/projects/add
 * Install the baseline autonomous loop into an EXISTING GitHub repo and
 * register the project. The heavy lifting lives in {@link installBaselineLoop}
 * (shared with the "start from a local folder" flow).
 *
 * Body: { owner, repo, label? }
 * Returns: { ok, project, commitUrl?, installed: string[], skipped: string[],
 *            labels: Record<name, "created"|"already existed"|"failed"> }
 */
export async function POST(req: Request) {
  let body: { owner?: string; repo?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const owner = (body.owner ?? "").trim();
  const repoName = (body.repo ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repoName)) {
    return NextResponse.json({ error: "Pick a repository first." }, { status: 400 });
  }
  const target: RepoConfig = { owner, repo: repoName };

  try {
    const result = await installBaselineLoop(target, { label: body.label });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OnboardError || err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("projects/add: failed", err);
    return NextResponse.json(
      {
        error:
          "Couldn't set the project up. Nothing may be half-done — check the repo on GitHub and try again.",
      },
      { status: 502 },
    );
  }
}
