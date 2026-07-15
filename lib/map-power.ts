/**
 * Loop power controls: pause/resume the whole loop, or single workflows,
 * using GitHub's workflow enable/disable API. Nothing is ever deleted —
 * a disabled workflow just stops being triggered until re-enabled.
 */

import { getOctokit, type RepoConfig } from "./github";

export const MENTION_FILE = "claude-mention.yml";

export type WorkflowPower = {
  /** Filename, e.g. "claude-scout.yml". */
  file: string;
  /** The workflow's display name from its YAML. */
  name: string;
  /** GitHub state: "active", "disabled_manually", ... */
  state: string;
  enabled: boolean;
  /** True for the @mention remote control (special-cased in master pause). */
  isMention: boolean;
};

/** Is this file part of the loop (subject to the power menu)? */
function isLoopWorkflow(path: string): boolean {
  const file = path.replace(/^\.github\/workflows\//, "");
  return /^claude-.*\.ya?ml$/.test(file) || file === "loop-metrics.yml";
}

/** Current on/off state of every loop workflow in a repo. */
export async function listLoopWorkflows(repo: RepoConfig): Promise<WorkflowPower[]> {
  const res = await getOctokit().rest.actions.listRepoWorkflows({
    owner: repo.owner,
    repo: repo.repo,
    per_page: 100,
  });
  return res.data.workflows
    .filter((w) => isLoopWorkflow(w.path))
    .map((w) => {
      const file = w.path.replace(/^\.github\/workflows\//, "");
      return {
        file,
        name: w.name,
        state: w.state,
        enabled: w.state === "active",
        isMention: file === MENTION_FILE,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** Switch one workflow on or off. `file` is the workflow filename. */
export async function setWorkflowEnabled(
  repo: RepoConfig,
  file: string,
  enabled: boolean,
): Promise<void> {
  const octokit = getOctokit();
  const params = { owner: repo.owner, repo: repo.repo, workflow_id: file };
  if (enabled) await octokit.rest.actions.enableWorkflow(params);
  else await octokit.rest.actions.disableWorkflow(params);
}

/**
 * Master pause: switch off every loop workflow EXCEPT @mention (the owner's
 * phone remote control stays reachable unless turned off individually).
 */
export async function pauseLoop(repo: RepoConfig): Promise<string[]> {
  const workflows = await listLoopWorkflows(repo);
  const targets = workflows.filter((w) => w.enabled && !w.isMention);
  for (const w of targets) {
    await setWorkflowEnabled(repo, w.file, false);
  }
  return targets.map((w) => w.file);
}

/** Master resume: switch every loop workflow back on (including @mention). */
export async function resumeLoop(repo: RepoConfig): Promise<string[]> {
  const workflows = await listLoopWorkflows(repo);
  const targets = workflows.filter((w) => !w.enabled);
  for (const w of targets) {
    await setWorkflowEnabled(repo, w.file, true);
  }
  return targets.map((w) => w.file);
}
