/**
 * GitHub plumbing.
 *
 * A single Octokit client (authenticated with GITHUB_TOKEN) plus thin,
 * typed wrappers around the endpoints the dashboard needs. Feature agents
 * are expected to extend this file — keep the wrappers small and predictable.
 *
 * Every helper takes an optional `repo` argument (defaults to REPOS.primary),
 * so the same functions work once more repos are added to REPOS.
 */

import { Octokit } from "octokit";

/* ------------------------------------------------------------------ */
/* Repo configuration                                                  */
/* ------------------------------------------------------------------ */

export type RepoConfig = { owner: string; repo: string };

/**
 * Registry of repos the dashboard controls. Add more entries here and every
 * helper below will work against them by passing the config as `repo`.
 */
export const REPOS = {
  primary: { owner: "ApagPlayz", repo: "content-generation-platform" },
} as const satisfies Record<string, RepoConfig>;

export type RepoKey = keyof typeof REPOS;

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

let _octokit: Octokit | null = null;

/** Lazily-created, shared Octokit client. */
export function getOctokit(): Octokit {
  if (_octokit) return _octokit;
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Add a fine-grained PAT to your environment / Vercel project settings.",
    );
  }
  _octokit = new Octokit({ auth: token });
  return _octokit;
}

/* ------------------------------------------------------------------ */
/* Issues & labels                                                     */
/* ------------------------------------------------------------------ */

/** List issues, optionally filtered by one or more labels. */
export async function listIssues(
  labels?: string | string[],
  opts: {
    state?: "open" | "closed" | "all";
    per_page?: number;
    repo?: RepoConfig;
  } = {},
) {
  const { owner, repo } = opts.repo ?? REPOS.primary;
  const res = await getOctokit().rest.issues.listForRepo({
    owner,
    repo,
    state: opts.state ?? "open",
    per_page: opts.per_page ?? 100,
    labels: Array.isArray(labels) ? labels.join(",") : labels,
  });
  // Filter out pull requests, which the issues endpoint also returns.
  return res.data.filter((i) => !i.pull_request);
}

/** Add one or more labels to an issue / PR. */
export async function addLabel(
  issueNumber: number,
  labels: string | string[],
  repo: RepoConfig = REPOS.primary,
) {
  const res = await getOctokit().rest.issues.addLabels({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: issueNumber,
    labels: Array.isArray(labels) ? labels : [labels],
  });
  return res.data;
}

/** Remove a single label from an issue / PR. */
export async function removeLabel(
  issueNumber: number,
  label: string,
  repo: RepoConfig = REPOS.primary,
) {
  const res = await getOctokit().rest.issues.removeLabel({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: issueNumber,
    name: label,
  });
  return res.data;
}

/** Create a comment on an issue or PR. */
export async function createComment(
  issueNumber: number,
  body: string,
  repo: RepoConfig = REPOS.primary,
) {
  const res = await getOctokit().rest.issues.createComment({
    owner: repo.owner,
    repo: repo.repo,
    issue_number: issueNumber,
    body,
  });
  return res.data;
}

/* ------------------------------------------------------------------ */
/* Pull requests                                                       */
/* ------------------------------------------------------------------ */

/** List pull requests. */
export async function listPRs(
  opts: {
    state?: "open" | "closed" | "all";
    per_page?: number;
    repo?: RepoConfig;
  } = {},
) {
  const { owner, repo } = opts.repo ?? REPOS.primary;
  const res = await getOctokit().rest.pulls.list({
    owner,
    repo,
    state: opts.state ?? "open",
    per_page: opts.per_page ?? 100,
  });
  return res.data;
}

/** Merge a pull request. */
export async function mergePR(
  prNumber: number,
  opts: {
    merge_method?: "merge" | "squash" | "rebase";
    commit_title?: string;
    repo?: RepoConfig;
  } = {},
) {
  const { owner, repo } = opts.repo ?? REPOS.primary;
  const res = await getOctokit().rest.pulls.merge({
    owner,
    repo,
    pull_number: prNumber,
    merge_method: opts.merge_method ?? "squash",
    commit_title: opts.commit_title,
  });
  return res.data;
}

/* ------------------------------------------------------------------ */
/* Workflows / Actions                                                 */
/* ------------------------------------------------------------------ */

/** List recent workflow runs (optionally scoped to a single workflow file). */
export async function getWorkflowRuns(
  opts: {
    workflowId?: string | number;
    per_page?: number;
    branch?: string;
    repo?: RepoConfig;
  } = {},
) {
  const { owner, repo } = opts.repo ?? REPOS.primary;
  const octokit = getOctokit();
  if (opts.workflowId !== undefined) {
    const res = await octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: opts.workflowId,
      per_page: opts.per_page ?? 30,
      branch: opts.branch,
    });
    return res.data.workflow_runs;
  }
  const res = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    per_page: opts.per_page ?? 30,
    branch: opts.branch,
  });
  return res.data.workflow_runs;
}

/**
 * Trigger a `workflow_dispatch` event for a workflow file (e.g. "scout.yml").
 * `ref` is the git ref to run on (defaults to "main").
 */
export async function dispatchWorkflow(
  workflowId: string | number,
  ref = "main",
  inputs: Record<string, string> = {},
  repo: RepoConfig = REPOS.primary,
) {
  await getOctokit().rest.actions.createWorkflowDispatch({
    owner: repo.owner,
    repo: repo.repo,
    workflow_id: workflowId,
    ref,
    inputs,
  });
  return { ok: true };
}

/**
 * Fire a `repository_dispatch` event (used for @claude-style remote control
 * and any custom event the loop listens for).
 */
export async function repositoryDispatch(
  eventType: string,
  payload: Record<string, unknown> = {},
  repo: RepoConfig = REPOS.primary,
) {
  await getOctokit().rest.repos.createDispatchEvent({
    owner: repo.owner,
    repo: repo.repo,
    event_type: eventType,
    client_payload: payload,
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Artifacts                                                           */
/* ------------------------------------------------------------------ */

/** List the artifacts produced by a workflow run. */
export async function listRunArtifacts(
  runId: number,
  repo: RepoConfig = REPOS.primary,
) {
  const res = await getOctokit().rest.actions.listWorkflowRunArtifacts({
    owner: repo.owner,
    repo: repo.repo,
    run_id: runId,
  });
  return res.data.artifacts;
}

/** Download an artifact as a zip. Returns the raw zip bytes as a Buffer. */
export async function downloadArtifact(
  artifactId: number,
  repo: RepoConfig = REPOS.primary,
): Promise<Buffer> {
  const res = await getOctokit().rest.actions.downloadArtifact({
    owner: repo.owner,
    repo: repo.repo,
    artifact_id: artifactId,
    archive_format: "zip",
  });
  return Buffer.from(res.data as ArrayBuffer);
}

/* ------------------------------------------------------------------ */
/* Repository contents                                                 */
/* ------------------------------------------------------------------ */

/**
 * Read a text file from the repo. Returns the decoded string, or `null` if
 * the file does not exist.
 */
export async function getFileContent(
  path: string,
  ref?: string,
  repo: RepoConfig = REPOS.primary,
): Promise<string | null> {
  try {
    const res = await getOctokit().rest.repos.getContent({
      owner: repo.owner,
      repo: repo.repo,
      path,
      ref,
    });
    const data = res.data;
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
      return null;
    }
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (err: unknown) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * Create or update a text file directly on a branch (defaults to "main") via
 * the contents API. Looks up the existing blob sha automatically when updating.
 */
export async function commitFile(
  path: string,
  content: string,
  message: string,
  opts: { branch?: string; repo?: RepoConfig } = {},
) {
  const repo = opts.repo ?? REPOS.primary;
  const branch = opts.branch ?? "main";
  const octokit = getOctokit();

  let sha: string | undefined;
  try {
    const existing = await octokit.rest.repos.getContent({
      owner: repo.owner,
      repo: repo.repo,
      path,
      ref: branch,
    });
    if (!Array.isArray(existing.data) && "sha" in existing.data) {
      sha = existing.data.sha;
    }
  } catch (err: unknown) {
    if (!isNotFound(err)) throw err;
  }

  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner: repo.owner,
    repo: repo.repo,
    path,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
    sha,
  });
  return res.data;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: number }).status === 404
  );
}
