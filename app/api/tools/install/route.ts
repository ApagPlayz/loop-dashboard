import { NextResponse } from "next/server";
import { repositoryDispatch, listWorkflowFiles, REPOS, type RepoConfig } from "@/lib/github";
import { TARGET_AGENTS } from "@/lib/tools";
import { resolveProject, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL_INSTALL_WORKFLOW = "claude-tool-install.yml";

/** Resolve the repo an install should target: a named project, else the pilot. */
async function repoForProject(project?: string | null): Promise<RepoConfig> {
  if (!project) return REPOS.primary;
  const { repo } = await resolveProject(project);
  return repo;
}

/**
 * GET /api/tools/install?project=<key>
 * Whether this project can install tools — i.e. its repo has the tool-installer
 * workflow. The map's "Install tools" tab uses this to gate installs with a
 * plain-English message for projects that aren't set up yet.
 */
export async function GET(req: Request) {
  const project = new URL(req.url).searchParams.get("project");
  try {
    const repo = await repoForProject(project);
    const files = await listWorkflowFiles({ repo });
    return NextResponse.json({ available: files.includes(TOOL_INSTALL_WORKFLOW) });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    // On a read hiccup, don't hard-block — assume available (the install POST
    // re-checks and gives a friendly error if it really isn't there).
    return NextResponse.json({ available: true });
  }
}

/**
 * POST /api/tools/install  Body: { url, target_agent, notes?, project? }.
 * Fires a `tool-install` repository_dispatch on the target project's repo (the
 * pilot by default) that the Tool-installer workflow listens for.
 */
export async function POST(req: Request) {
  let body: { url?: string; target_agent?: string; notes?: string; project?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  const target = (body.target_agent ?? "").trim();

  try {
    new URL(url);
  } catch {
    return NextResponse.json(
      { error: "That doesn't look like a valid link. Paste the full web address." },
      { status: 400 },
    );
  }

  if (!TARGET_AGENTS.some((a) => a.value === target)) {
    return NextResponse.json({ error: "Pick which agent should get this tool." }, { status: 400 });
  }

  let repo: RepoConfig;
  try {
    repo = await repoForProject(body.project);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: "Couldn't find that project." }, { status: 502 });
  }

  // Gate: the target repo must actually have the tool-installer workflow.
  try {
    const files = await listWorkflowFiles({ repo });
    if (!files.includes(TOOL_INSTALL_WORKFLOW)) {
      return NextResponse.json(
        {
          error:
            "This project doesn't have the tool-installer set up yet. Onboard it from the Projects menu first.",
          notInstalled: true,
        },
        { status: 404 },
      );
    }
  } catch {
    // If the check itself fails, fall through and let the dispatch try.
  }

  try {
    await repositoryDispatch("tool-install", { url, target_agent: target, notes: body.notes ?? "" }, repo);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not start the install. Please try again." }, { status: 500 });
  }
}
