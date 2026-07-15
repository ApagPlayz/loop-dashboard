import { NextResponse } from "next/server";
import { getWorkflowRuns } from "@/lib/github";
import { toRunSummary } from "@/lib/testing";
import { listToolInstallPrs } from "@/lib/tools";

export const dynamic = "force-dynamic";

/**
 * Install activity: recent claude-tool-install.yml runs and any open claude/
 * PRs that look like a tool install.
 */
export async function GET() {
  let runs: ReturnType<typeof toRunSummary>[] = [];
  try {
    const raw = await getWorkflowRuns({
      workflowId: "claude-tool-install.yml",
      per_page: 8,
    });
    runs = raw.map(toRunSummary);
  } catch {
    // Workflow not on main yet (PR #44) → no runs. Not an error for the UI.
    runs = [];
  }

  let prs: Awaited<ReturnType<typeof listToolInstallPrs>> = [];
  try {
    prs = await listToolInstallPrs();
  } catch {
    prs = [];
  }

  return NextResponse.json({ runs, prs });
}
