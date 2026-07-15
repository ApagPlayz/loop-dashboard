import { NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import { listProjects, DASHBOARD_REPO } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/projects/repos
 * Repos the dashboard's GitHub token can see, minus ones already on the
 * dashboard and the dashboard repo itself — candidates for "Add a project".
 * Note: a fine-grained token only lists the repos it was granted.
 */
export async function GET() {
  try {
    const [projects, res] = await Promise.all([
      listProjects(),
      getOctokit().rest.repos.listForAuthenticatedUser({
        per_page: 100,
        sort: "updated",
      }),
    ]);
    const taken = new Set(projects.map((p) => `${p.owner}/${p.repo}`.toLowerCase()));
    taken.add(`${DASHBOARD_REPO.owner}/${DASHBOARD_REPO.repo}`.toLowerCase());

    const repos = res.data
      .filter((r) => !taken.has(r.full_name.toLowerCase()))
      .map((r) => ({
        owner: r.owner.login,
        repo: r.name,
        fullName: r.full_name,
        description: r.description ?? "",
        private: r.private,
        defaultBranch: r.default_branch,
      }));
    return NextResponse.json({ repos });
  } catch (err) {
    console.error("projects/repos: failed", err);
    return NextResponse.json(
      { error: "Couldn't list your GitHub repositories. Check the token's access." },
      { status: 502 },
    );
  }
}
