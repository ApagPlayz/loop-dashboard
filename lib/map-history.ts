/**
 * Version history + atomic multi-file commits for the loop's workflow files.
 *
 * Restores and multi-file AI edits go through the Git Data API
 * (createTree → createCommit → updateRef) so every change lands as ONE commit
 * on the target repo's main. Nothing here ever force-pushes or rewrites
 * history — a restore is always a new commit on top.
 */

import { getOctokit, REPOS, type RepoConfig } from "./github";

export const WORKFLOWS_DIR = ".github/workflows";

/* ------------------------------------------------------------------ */
/* Commit listing & diffs                                              */
/* ------------------------------------------------------------------ */

export type CommitSummary = {
  sha: string;
  message: string;
  date: string | null;
  url: string;
};

/** Commits on main touching a path (a single file, or the workflows dir). */
export async function listCommitsForPath(
  path: string,
  opts: { per_page?: number; repo?: RepoConfig } = {},
): Promise<CommitSummary[]> {
  const { owner, repo } = opts.repo ?? REPOS.primary;
  const res = await getOctokit().rest.repos.listCommits({
    owner,
    repo,
    sha: "main",
    path,
    per_page: opts.per_page ?? 30,
  });
  return res.data.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split("\n")[0],
    date: c.commit.committer?.date ?? c.commit.author?.date ?? null,
    url: c.html_url,
  }));
}

export type FilePatch = {
  filename: string;
  status: string;
  patch: string | null;
};

/** The per-file patches of one commit, filtered to a path prefix. */
export async function getCommitPatches(
  sha: string,
  pathPrefix: string,
  repo: RepoConfig = REPOS.primary,
): Promise<{ patches: FilePatch[]; url: string }> {
  const res = await getOctokit().rest.repos.getCommit({
    owner: repo.owner,
    repo: repo.repo,
    ref: sha,
  });
  const patches = (res.data.files ?? [])
    .filter((f) => f.filename.startsWith(pathPrefix))
    .map((f) => ({
      filename: f.filename,
      status: f.status ?? "modified",
      patch: f.patch ?? null,
    }));
  return { patches, url: res.data.html_url };
}

/* ------------------------------------------------------------------ */
/* Atomic multi-file commit (Git Data API)                             */
/* ------------------------------------------------------------------ */

export type TreeChange = {
  /** Full path in the repo, e.g. ".github/workflows/claude-scout.yml". */
  path: string;
  /** New file content, or null to delete the file in this commit. */
  content: string | null;
};

/**
 * Commit a set of file changes to main as ONE commit. Never force-pushes:
 * the new commit's parent is the current head of main, so history is
 * preserved and a concurrent push surfaces as a 422 on updateRef.
 */
export async function atomicCommit(
  changes: TreeChange[],
  message: string,
  repo: RepoConfig = REPOS.primary,
): Promise<{ sha: string; url: string }> {
  if (changes.length === 0) throw new Error("No changes to commit.");
  const octokit = getOctokit();
  const { owner, repo: name } = repo;

  const ref = await octokit.rest.git.getRef({ owner, repo: name, ref: "heads/main" });
  const headSha = ref.data.object.sha;
  const headCommit = await octokit.rest.git.getCommit({
    owner,
    repo: name,
    commit_sha: headSha,
  });

  const tree = changes.map((c) =>
    c.content === null
      ? { path: c.path, mode: "100644" as const, type: "blob" as const, sha: null }
      : { path: c.path, mode: "100644" as const, type: "blob" as const, content: c.content },
  );

  const newTree = await octokit.rest.git.createTree({
    owner,
    repo: name,
    base_tree: headCommit.data.tree.sha,
    tree,
  });

  const newCommit = await octokit.rest.git.createCommit({
    owner,
    repo: name,
    message,
    tree: newTree.data.sha,
    parents: [headSha],
  });

  await octokit.rest.git.updateRef({
    owner,
    repo: name,
    ref: "heads/main",
    sha: newCommit.data.sha,
    force: false,
  });

  return {
    sha: newCommit.data.sha,
    url: `https://github.com/${owner}/${name}/commit/${newCommit.data.sha}`,
  };
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

/** Map of workflow filename → content for a given ref (commit sha or branch). */
export async function snapshotWorkflows(
  ref: string,
  repo: RepoConfig = REPOS.primary,
): Promise<Map<string, string>> {
  const octokit = getOctokit();
  const { owner, repo: name } = repo;
  const dir = await octokit.rest.repos.getContent({
    owner,
    repo: name,
    path: WORKFLOWS_DIR,
    ref,
  });
  if (!Array.isArray(dir.data)) throw new Error("Workflows directory not found at that version.");

  const out = new Map<string, string>();
  await Promise.all(
    dir.data
      .filter((entry) => entry.type === "file")
      .map(async (entry) => {
        const file = await octokit.rest.repos.getContent({
          owner,
          repo: name,
          path: entry.path,
          ref,
        });
        if (!Array.isArray(file.data) && file.data.type === "file" && "content" in file.data) {
          out.set(entry.name, Buffer.from(file.data.content, "base64").toString("utf-8"));
        }
      }),
  );
  return out;
}
