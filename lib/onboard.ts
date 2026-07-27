/**
 * Baseline-loop onboarding — the single code path that turns an EXISTING
 * GitHub repo into a loop-controlled project.
 *
 * Everything installed comes from ONE place: the editable new-project template
 * in this repo (config/loop-template/workflows/ + config/loop-template/files/).
 * There is deliberately no live-pilot fallback — a silent fallback is how the
 * pilot's own state leaked into new projects. If the template can't be read, or
 * is empty, onboarding fails loudly and nothing is written.
 *
 * On top of the template it seeds a fresh LEARNINGS.md, an empty metrics file,
 * a product brief (docs/loop-brief.md) and a minimal CLAUDE.md pointing at it,
 * creates the idea labels, and registers the project in config/projects.json.
 * It is reused verbatim by:
 *   - /api/map/projects/add        (pick an existing GitHub repo)
 *   - /api/projects/local-init     (push a local folder, then onboard it)
 * so the two never drift apart.
 */

import { getOctokit, getFileContent, LOOP_LABELS, type RepoConfig } from "./github";
import { atomicCommit, WORKFLOWS_DIR, type TreeChange } from "./map-history";
import { listProjects, addProject, DASHBOARD_REPO, type Project } from "./projects";
import { listTemplateWorkflows, listTemplateFiles, TEMPLATE_FILE_TARGETS } from "./loop-template";
import { DEFAULT_LOOP_CONFIG, LOOP_CONFIG_PATH, serializeLoopConfig } from "./loop-config";

/** Where the product brief lives in a target repo (must match the template). */
const BRIEF_PATH = TEMPLATE_FILE_TARGETS["loop-brief.md"];

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

/**
 * A minimal root CLAUDE.md, seeded only when the repo has none. Three agent
 * prompts tell agents to read CLAUDE.md, so an empty repo left them with
 * nothing; this points them at the brief that actually carries the product
 * context.
 */
const FRESH_CLAUDE_MD = `# Working in this repo

**Read \`${BRIEF_PATH}\` before you do anything.** It is the product brief: what this
product is, what the owner is currently trying to achieve, what is off-limits, and how the
owner likes to be pitched. If it still contains placeholder text, say so instead of
guessing.

Also read:

- \`LEARNINGS.md\` — mistakes this loop has already made. Don't repeat them.
- \`docs/DASHBOARD-CONTRACT.md\` — the handshakes between the owner's dashboard and this
  repo's workflows. Change one side, change the other.

Repo-specific conventions (build commands, code layout, house style) belong in this file —
add them as you learn them.
`;

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

  // ----- gather the baseline from the template -------------------------
  // The ONLY source is config/loop-template/ in the dashboard repo. There is
  // no pilot fallback on purpose: silently cloning the pilot is how its
  // project-specific state leaked into new repos. A broken template is an
  // error the owner has to see, not something to paper over.
  let workflows: Map<string, string>;
  let templateFiles: Map<string, string>;
  try {
    [workflows, templateFiles] = await Promise.all([listTemplateWorkflows(), listTemplateFiles()]);
  } catch (err) {
    console.error("onboard: template read failed", err);
    throw new OnboardError(
      "Couldn't read the new-project template from GitHub, so nothing was installed. Try again in a moment.",
      502,
    );
  }
  if (workflows.size === 0) {
    throw new OnboardError(
      "The new-project template has no workflows, so there's nothing to install. Seed it on the Process Map first (Template → Seed), then add this project.",
      409,
    );
  }
  const missingAssets = Object.keys(TEMPLATE_FILE_TARGETS).filter((name) => !templateFiles.has(name));
  if (missingAssets.length > 0) {
    throw new OnboardError(
      `The new-project template is missing ${missingAssets.join(", ")} — onboarding would install a broken loop (e.g. a metrics workflow with no script). Restore config/loop-template/files/ in the dashboard repo first.`,
      409,
    );
  }

  const files = new Map<string, string>();
  for (const [name, content] of workflows) {
    files.set(`${WORKFLOWS_DIR}/${name}`, content);
  }
  for (const [name, content] of templateFiles) {
    const target = TEMPLATE_FILE_TARGETS[name];
    if (target) files.set(target, content);
  }
  files.set("LEARNINGS.md", FRESH_LEARNINGS);
  files.set("metrics/loop-metrics.json", "[]\n");
  // Written through the same serializer every later save uses, so a brand-new
  // project's file is byte-identical to one the dashboard has re-saved — a
  // hand-rolled JSON.stringify here meant the very first save always looked
  // like someone else had edited the file.
  files.set(LOOP_CONFIG_PATH, serializeLoopConfig(DEFAULT_LOOP_CONFIG));

  // A repo with no CLAUDE.md leaves three agent prompts reading nothing, so
  // seed a minimal one that points at the brief. The "skip anything the repo
  // already has" pass below means an existing CLAUDE.md is never overwritten.
  // (The brief itself, docs/loop-brief.md, comes from the template's files/.)
  files.set("CLAUDE.md", FRESH_CLAUDE_MD);

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
  // LOOP_LABELS lives in lib/github.ts so this and the on-the-fly creation in
  // `setIssueLabels` can't disagree about a label's colour (they did).
  const labels: Record<string, string> = {};
  for (const [name, { color, description }] of Object.entries(LOOP_LABELS)) {
    try {
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
