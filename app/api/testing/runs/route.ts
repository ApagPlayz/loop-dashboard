import { NextResponse } from "next/server";
import { getWorkflowRuns } from "@/lib/github";
import { toRunSummary } from "@/lib/testing";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * Recent workflow runs. Optional query params:
 *   ?file=claude-scout.yml   scope to one workflow
 *   ?per_page=15             how many
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const file = url.searchParams.get("file") ?? undefined;
  const perPage = Number(url.searchParams.get("per_page") ?? "15");

  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const runs = await getWorkflowRuns({
      workflowId: file,
      per_page: Number.isFinite(perPage) ? perPage : 15,
      repo,
    });
    return NextResponse.json({ runs: runs.map(toRunSummary) });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json(
      { error: "Could not load runs from GitHub." },
      { status: 500 },
    );
  }
}
