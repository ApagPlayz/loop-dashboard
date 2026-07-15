/**
 * Baseline-loop onboarding — the single code path that turns an EXISTING
 * GitHub repo into a loop-controlled project.
 *
 * It copies the baseline set of workflows + config from the pilot, seeds a
 * fresh LEARNINGS.md and empty metrics, creates the three idea labels, and
 * registers the project in config/projects.json. It is reused verbatim by:
 *   - /api/map/projects/add        (pick an existing GitHub repo)
 *   - /api/projects/local-init     (push a local folder, then onboard it)
 * so the two never drift apart.
 */

import { getOctokit, getFileContent, type RepoConfig } from "./github";
import { atomicCommit, snapshotWorkflows, WORKFLOWS_DIR, type TreeChange } from "./map-history";
import { listProjects, addProject, DASHBOARD_REPO, PILOT_PROJECT, type Project } from "./projects";

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

export type OnboardResult = {
  project: Project;
  commitUrl?: string;
  installed: string[];
  skipped: string[];
  labels: Record<string, string>;
};

/** Error carrying the HTTP status a route should surface for it. */
export class OnboardError extends Error {
  constructor(
    message: string,
    public httpStatus: number = 400,
  ) {
    super(message);
    this.name = "OnboardError";
  }
}

/**
 * Install the baseline autonomous loop into `target` and register it.
 * Assumes `target.repo` is the desired registry name; the key is its
 * lowercase form. Throws {@link OnboardError} with a plain-English message
 * (and the right status) for every expected failure.
 */
export async function installBaselineLoop(
  target: RepoConfig,
  opts: { label?: string } = {},
): Promise<OnboardResult> {
  const { owner, repo: repoName } = target;
  const key = repoName.toLowerCase();
  const octokit = getOctokit();

  // ----- validations --------------------------------------------------
  if (
    owner.toLowerCase() === DASHBOARD_REPO.owner.toLowerCase() &&
    repoName.toLowerCase() === DASHBOARD_REPO.repo.toLowerCase()
  ) {
    throw new OnboardError("That's the dashboard itself — it can't run a loop on itself.", 400);
  }
  const existing = await listProjects(true);
  if (existing.some((p) => p.owner === owner && p.repo === repoName)) {
    throw new OnboardError("That repo is already on the dashboard.", 409);
  }
  if (existing.some((p) => p.key === key)) {
    throw new OnboardError("A project with the same name is already on the dashboard.", 409);
  }

  let repoInfo;
  try {
    repoInfo = (await octokit.rest.repos.get({ owner, repo: repoName })).data;
  } catch {
    throw new OnboardError(
      "The dashboard's GitHub token can't see that repository. Grant it access first.",
      404,
    );
  }
  if (repoInfo.default_branch !== "main") {
    throw new OnboardError(
      `The loop expects the repo's main branch to be called "main" (this one uses "${repoInfo.default_branch}"). Rename it on GitHub first, then try again.`,
      400,
    );
  }

  // ----- gather the baseline from the pilot ---------------------------
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

  // ----- skip anything the target repo already has --------------------
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

  // ----- one atomic commit --------------------------------------------
  let commitUrl: string | undefined;
  if (changes.length > 0) {
    try {
      const res = await atomicCommit(changes, "dashboard: install baseline autonomous loop", target);
      commitUrl = res.url;
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 409 || status === 404) {
        throw new OnboardError(
          "The repo looks empty (no commits yet). Push a first commit — even just a README — then try again.",
          400,
        );
      }
      throw err;
    }
  }

  // ----- labels -------------------------------------------------------
  const labels: Record<string, string> = {};
  for (const name of LOOP_LABELS) {
    try {
      let color = LABEL_FALLBACK[name].color;
      let description = LABEL_FALLBACK[name].description;
      try {
        const pilotLabel = (await octokit.rest.issues.getLabel({ ...PILOT_REPO, name })).data;
        color = pilotLabel.color;
        description = pilotLabel.description ?? description;
      } catch {
        /* use fallback */
      }
      await octokit.rest.issues.createLabel({ owner, repo: repoName, name, color, description });
      labels[name] = "created";
    } catch (err: unknown) {
      if ((err as { status?: number })?.status === 422) {
        labels[name] = "already existed";
      } else {
        console.error(`onboard: label ${name} failed`, err);
        labels[name] = "failed";
      }
    }
  }

  // ----- register -----------------------------------------------------
  const project = await addProject({
    key,
    owner,
    repo: repoName,
    label: opts.label?.trim() || repoInfo.name,
  });

  return { project, commitUrl, installed, skipped, labels };
}
