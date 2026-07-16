/**
 * The editable NEW-PROJECT TEMPLATE.
 *
 * What gets installed into a brand-new project used to be a live snapshot of
 * the pilot repo. Now it's a real, editable set of workflow files stored in
 * THIS dashboard repo at config/loop-template/workflows/*.yml, read and
 * written through the GitHub API (same pattern as config/projects.json).
 *
 * - `listTemplateWorkflows` is what onboarding reads (lib/onboard.ts falls
 *   back to a pilot snapshot when the template is missing or empty, so a
 *   broken/deleted template can never block adding a project).
 * - `seedTemplateFromPilot` initializes the template ONCE by copying the
 *   pilot's current workflows.
 * - `applyTemplateChanges` commits AI-drafted template edits (modify, add,
 *   or remove workflow files) as one commit to the dashboard repo.
 */

import { getOctokit, type RepoConfig } from "./github";
import { atomicCommit, snapshotWorkflows, type TreeChange } from "./map-history";
import { DASHBOARD_REPO, PILOT_PROJECT } from "./projects";

export const TEMPLATE_DIR = "config/loop-template";
export const TEMPLATE_WORKFLOWS_DIR = `${TEMPLATE_DIR}/workflows`;

const PILOT_REPO: RepoConfig = { owner: PILOT_PROJECT.owner, repo: PILOT_PROJECT.repo };

/** Error carrying the HTTP status a route should surface for it. */
export class TemplateError extends Error {
  constructor(
    message: string,
    public httpStatus: number = 400,
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

/** Workflow filenames only — no paths, no traversal, YAML only. */
export function isValidTemplateFileName(file: string): boolean {
  return /^[A-Za-z0-9._-]+\.ya?ml$/.test(file);
}

/**
 * Map of workflow filename → content for the template. Empty map when the
 * template hasn't been seeded yet (or was emptied out).
 */
export async function listTemplateWorkflows(): Promise<Map<string, string>> {
  const octokit = getOctokit();
  const out = new Map<string, string>();
  let entries: { type: string; name: string; path: string }[];
  try {
    const res = await octokit.rest.repos.getContent({
      owner: DASHBOARD_REPO.owner,
      repo: DASHBOARD_REPO.repo,
      path: TEMPLATE_WORKFLOWS_DIR,
    });
    if (!Array.isArray(res.data)) return out;
    entries = res.data;
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 404) return out; // not seeded yet
    throw err;
  }

  await Promise.all(
    entries
      .filter((e) => e.type === "file" && isValidTemplateFileName(e.name))
      .map(async (e) => {
        const file = await octokit.rest.repos.getContent({
          owner: DASHBOARD_REPO.owner,
          repo: DASHBOARD_REPO.repo,
          path: e.path,
        });
        if (!Array.isArray(file.data) && file.data.type === "file" && "content" in file.data) {
          out.set(e.name, Buffer.from(file.data.content, "base64").toString("utf-8"));
        }
      }),
  );
  return out;
}

export type SeedResult = {
  /** True when the template already existed and nothing was done. */
  alreadySeeded: boolean;
  files: string[];
  commitUrl?: string;
};

/**
 * Initialize the template ONCE by copying the pilot project's current
 * workflow files into config/loop-template/workflows/. A no-op (and safe to
 * call again) when the template already has files.
 */
export async function seedTemplateFromPilot(): Promise<SeedResult> {
  const existing = await listTemplateWorkflows();
  if (existing.size > 0) {
    return { alreadySeeded: true, files: [...existing.keys()].sort() };
  }

  let workflows: Map<string, string>;
  try {
    workflows = await snapshotWorkflows("main", PILOT_REPO);
  } catch (err) {
    console.error("loop-template: pilot snapshot failed", err);
    throw new TemplateError(
      "Couldn't read the pilot project's workflows to copy from. Try again.",
      502,
    );
  }
  if (workflows.size === 0) {
    throw new TemplateError("The pilot project has no workflow files to copy.", 502);
  }

  const changes: TreeChange[] = [...workflows.entries()].map(([name, content]) => ({
    path: `${TEMPLATE_WORKFLOWS_DIR}/${name}`,
    content,
  }));
  const res = await atomicCommit(
    changes,
    "dashboard: seed the new-project template from the pilot",
    DASHBOARD_REPO,
  );
  return { alreadySeeded: false, files: [...workflows.keys()].sort(), commitUrl: res.url };
}

export type TemplateFileEdit = {
  /** Workflow filename only, e.g. "claude-scout.yml". */
  file: string;
  /** New content, or null to remove the file from the template. */
  newContent: string | null;
};

/**
 * Commit a set of template edits (modify / add / remove workflow files) as
 * ONE commit to the dashboard repo. Throws {@link TemplateError} with a
 * plain-English message for every expected failure.
 */
export async function applyTemplateChanges(
  edits: TemplateFileEdit[],
  summary: string,
): Promise<{ commitUrl: string }> {
  if (edits.length === 0) throw new TemplateError("No changes to apply.");
  const changes: TreeChange[] = [];
  for (const e of edits) {
    const file = (e.file ?? "").trim();
    if (!isValidTemplateFileName(file)) {
      throw new TemplateError(`Invalid file name: ${file || "(empty)"}`);
    }
    if (e.newContent !== null && e.newContent.trim() === "") {
      throw new TemplateError(`Empty content for ${file}.`);
    }
    changes.push({ path: `${TEMPLATE_WORKFLOWS_DIR}/${file}`, content: e.newContent });
  }

  const firstLine = (summary || "template change").split("\n")[0].trim();
  const short = firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;

  try {
    const res = await atomicCommit(changes, `dashboard: template edit — ${short}`, DASHBOARD_REPO);
    return { commitUrl: res.url };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 409 || status === 422) {
      throw new TemplateError(
        "The template changed while you were reviewing. Ask for the change again to pick up the latest version.",
        409,
      );
    }
    console.error("loop-template: apply failed", err);
    throw new TemplateError("Couldn't save to GitHub. Try again.", 502);
  }
}
