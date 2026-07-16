import { NextResponse } from "next/server";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * GET /api/tools/fit/repos — the registered projects, for the repo picker's
 * dropdown. The picker also accepts a free-text owner/name for any other repo
 * the token can see.
 */
export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({
      projects: projects.map((p) => ({
        owner: p.owner,
        repo: p.repo,
        label: p.label,
        fullName: `${p.owner}/${p.repo}`,
      })),
    });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}
