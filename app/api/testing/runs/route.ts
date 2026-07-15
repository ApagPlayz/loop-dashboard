import { NextResponse } from "next/server";
import { getWorkflowRuns } from "@/lib/github";
import { toRunSummary } from "@/lib/testing";

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
    const runs = await getWorkflowRuns({
      workflowId: file,
      per_page: Number.isFinite(perPage) ? perPage : 15,
    });
    return NextResponse.json({ runs: runs.map(toRunSummary) });
  } catch {
    return NextResponse.json(
      { error: "Could not load runs from GitHub." },
      { status: 500 },
    );
  }
}
