import { NextResponse } from "next/server";
import { getWorkflowRuns, type RepoConfig } from "@/lib/github";
import { toRunSummary } from "@/lib/testing";
import { listToolInstallPrs } from "@/lib/tools";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * GET /api/tools/activity?project=<key>
 * Install activity for ONE project: recent claude-tool-install.yml runs and any
 * open claude/ PRs that look like a tool install.
 *
 * `project` is required — both reads hit a target repo, and defaulting meant
 * the Tools page showed the pilot's installs from every other project.
 */
export async function GET(req: Request) {
  let repo: RepoConfig;
  try {
    ({ repo } = await resolveProjectFromUrl(req.url));
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json(
        { runs: [], prs: [], error: err.message },
        { status: err.httpStatus },
      );
    }
    return NextResponse.json(
      { runs: [], prs: [], error: "Could not load install activity." },
      { status: 500 },
    );
  }

  let runs: ReturnType<typeof toRunSummary>[] = [];
  try {
    const raw = await getWorkflowRuns({
      workflowId: "claude-tool-install.yml",
      per_page: 8,
      repo,
    });
    runs = raw.map(toRunSummary);
  } catch {
    // Workflow not installed on this project → no runs. Not an error for the UI.
    runs = [];
  }

  let prs: Awaited<ReturnType<typeof listToolInstallPrs>> = [];
  try {
    prs = await listToolInstallPrs(repo);
  } catch {
    prs = [];
  }

  return NextResponse.json({ runs, prs });
}
