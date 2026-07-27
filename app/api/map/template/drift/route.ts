import { NextResponse } from "next/server";
import { computeTemplateDrift } from "@/lib/loop-template";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/template/drift?project=<key>
 *
 * How far one project's live .github/workflows/ has drifted from the
 * new-project template. Read-only: it compares the two existing primitives
 * (listTemplateWorkflows + snapshotWorkflows) and never writes anything.
 *
 * Returns:
 * {
 *   project: string,
 *   projectLabel: string,
 *   inSync: boolean,
 *   templateEmpty: boolean,
 *   counts: { identical, "repo-behind-or-diverged", "missing-in-repo", "extra-in-repo" },
 *   files: [{ file, status, diff }]      // diff is "" when status is identical
 * }
 *
 * A repo whose workflows can't be read (rate limit, outage) is a 502, NOT an
 * empty comparison — reporting every file as "missing in repo" because GitHub
 * was briefly unavailable is worse than saying nothing.
 */
export async function GET(req: Request) {
  try {
    const { project, repo } = await resolveProjectFromUrl(req.url);
    const drift = await computeTemplateDrift(project.key, repo);
    return NextResponse.json({ ...drift, projectLabel: project.label });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("template drift: read failed", err);
    return NextResponse.json(
      { error: "Couldn't compare this project against the template. Try again." },
      { status: 502 },
    );
  }
}
