import { NextResponse } from "next/server";
import { getOctokit, getFileContent, type RepoConfig } from "@/lib/github";
import { atomicCommit, snapshotWorkflows, WORKFLOWS_DIR, type TreeChange } from "@/lib/map-history";
import { listProjects, addProject, DASHBOARD_REPO, PILOT_PROJECT, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PILOT_REPO: RepoConfig = { owner: PILOT_PROJECT.owner, repo: PILOT_PROJECT.repo };

/** Non-workflow baseline files copied verbatim from the pilot. */
const COPY_FILES = [".mcp.json", "docs/DASHBOARD-CONTRACT.md", "scripts/loop-metrics.mjs"];

/** Fresh seeds — never copied from the pilot (its content is pilot-specific). */
const FRESH_LEARNINGS = `# Learnings

Every agent working on this repo reads this file before it starts.

It records **mistakes the loop has already made**, so it stops making them. Only failures
and corrections go here — never successes. A file of self-congratulation would just dilute
the context that every future agent has to load.

Rules: max 50 lines. Dated entries. The weekly retro proposes additions via pull request;
nothing is added here without the owner merging it.

---

Nothing learned yet — this loop is brand new.
`;

const LOOP_LABELS = ["proposal", "approved", "redraft"] as const;
// Colors/descriptions as on the pilot — used if reading the pilot's labels fails.
const LABEL_FALLBACK: Record<string, { color: string; description: string }> = {
  proposal: { color: "0E8A16", description: "Agent-proposed improvement awaiting your triage" },
  approved: { color: "1D76DB", description: "Owner-approved: builder loop may implement" },
  redraft: {
    color: "D93F0B",
    description: "Owner sent this proposal back for the agent to rewrite from feedback",
  },
};

/**
 * POST /api/map/projects/add
 * Install the baseline autonomous loop into a repo and register the project.
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
  const key = repoName.toLowerCase();

  const octokit = getOctokit();

  try {
    // ----- validations ------------------------------------------------
    if (
      owner.toLowerCase() === DASHBOARD_REPO.owner.toLowerCase() &&
      repoName.toLowerCase() === DASHBOARD_REPO.repo.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "That's the dashboard itself — it can't run a loop on itself." },
        { status: 400 },
      );
    }
    const existing = await listProjects(true);
    if (existing.some((p) => p.owner === owner && p.repo === repoName)) {
      return NextResponse.json({ error: "That repo is already on the dashboard." }, { status: 409 });
    }
    if (existing.some((p) => p.key === key)) {
      return NextResponse.json(
        { error: "A project with the same name is already on the dashboard." },
        { status: 409 },
      );
    }

    let repoInfo;
    try {
      repoInfo = (await octokit.rest.repos.get({ owner, repo: repoName })).data;
    } catch {
      return NextResponse.json(
        { error: "The dashboard's GitHub token can't see that repository. Grant it access first." },
        { status: 404 },
      );
    }
    if (repoInfo.default_branch !== "main") {
      return NextResponse.json(
        {
          error: `The loop expects the repo's main branch to be called "main" (this one uses "${repoInfo.default_branch}"). Rename it on GitHub first, then try again.`,
        },
        { status: 400 },
      );
    }

    // ----- gather the baseline from the pilot -------------------------
    const workflows = await snapshotWorkflows("main", PILOT_REPO);
    const files = new Map<string, string>();
    for (const [name, content] of workflows) {
      files.set(`${WORKFLOWS_DIR}/${name}`, content);
    }
    for (const path of COPY_FILES) {
      const content = await getFileContent(path, "main", PILOT_REPO);
      if (content !== null) files.set(path, content);
    }
    files.set("LEARNINGS.md", FRESH_LEARNINGS);
    files.set("metrics/loop-metrics.json", "[]\n");

    // ----- skip anything the target repo already has -------------------
    const installed: string[] = [];
    const skipped: string[] = [];
    const changes: TreeChange[] = [];
    for (const [path, content] of files) {
      const already = await getFileContent(path, "main", target).catch(() => null);
      if (already !== null) {
        skipped.push(path);
      } else {
        installed.push(path);
        changes.push({ path, content });
      }
    }

    // ----- one atomic commit -------------------------------------------
    let commitUrl: string | undefined;
    if (changes.length > 0) {
      try {
        const res = await atomicCommit(
          changes,
          "dashboard: install baseline autonomous loop",
          target,
        );
        commitUrl = res.url;
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status === 409 || status === 404) {
          return NextResponse.json(
            {
              error:
                "The repo looks empty (no commits yet). Push a first commit — even just a README — then try again.",
            },
            { status: 400 },
          );
        }
        throw err;
      }
    }

    // ----- labels --------------------------------------------------------
    const labels: Record<string, string> = {};
    for (const name of LOOP_LABELS) {
      try {
        let color = LABEL_FALLBACK[name].color;
        let description = LABEL_FALLBACK[name].description;
        try {
          const pilotLabel = (
            await octokit.rest.issues.getLabel({ ...PILOT_REPO, name })
          ).data;
          color = pilotLabel.color;
          description = pilotLabel.description ?? description;
        } catch {
          /* use fallback */
        }
        await octokit.rest.issues.createLabel({
          owner,
          repo: repoName,
          name,
          color,
          description,
        });
        labels[name] = "created";
      } catch (err: unknown) {
        if ((err as { status?: number })?.status === 422) {
          labels[name] = "already existed";
        } else {
          console.error(`projects/add: label ${name} failed`, err);
          labels[name] = "failed";
        }
      }
    }

    // ----- register -------------------------------------------------------
    const project = await addProject({
      key,
      owner,
      repo: repoName,
      label: body.label?.trim() || repoInfo.name,
    });

    return NextResponse.json({ ok: true, project, commitUrl, installed, skipped, labels });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("projects/add: failed", err);
    return NextResponse.json(
      { error: "Couldn't set the project up. Nothing may be half-done — check the repo on GitHub and try again." },
      { status: 502 },
    );
  }
}
