import { NextResponse } from "next/server";
import { WORKFLOWS, listWorkflowCommits } from "@/lib/testing";
import { resolveProjectFromUrl } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * Instruction change timeline: for each agent workflow file, the recent commits
 * on main that touched it (newest first), grouped per agent.
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const groups = await Promise.all(
      WORKFLOWS.map(async (w) => ({
        file: w.file,
        name: w.name,
        commits: await listWorkflowCommits(`.github/workflows/${w.file}`, 10, repo),
      })),
    );
    // Only show agents that actually have commit history.
    return NextResponse.json({
      groups: groups.filter((g) => g.commits.length > 0),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load instruction history." },
      { status: 500 },
    );
  }
}
