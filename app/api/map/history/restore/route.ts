import { NextResponse } from "next/server";
import { getOctokit, getFileContent, commitFile } from "@/lib/github";
import { AGENTS } from "@/lib/map-agents";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import {
  atomicCommit,
  snapshotWorkflows,
  WORKFLOWS_DIR,
  type TreeChange,
} from "@/lib/map-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILE_RE = /^[A-Za-z0-9._-]+\.ya?ml$/;

function friendlyDate(iso: string | null): string {
  if (!iso) return "an earlier version";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * POST /api/map/history/restore
 * Put workflow file(s) back exactly as they were at an earlier commit.
 * Always a NEW commit on main — history is never rewritten or force-pushed.
 *
 * Body: { sha: string, file?: string }
 *   with `file`   — restore that one workflow via a single-file commit
 *   without       — restore ALL workflow files at that commit (one atomic
 *                   commit; files added since are removed, files that existed
 *                   then are put back)
 * Returns: { commitUrl }
 */
export async function POST(req: Request) {
  let repo;
  try {
    ({ repo } = await resolveProjectFromUrl(req.url));
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }

  let body: { sha?: string; file?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const sha = (body.sha ?? "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return NextResponse.json({ error: "Invalid version id." }, { status: 400 });
  }

  // Date of the source commit, for the commit message.
  let dateIso: string | null = null;
  try {
    const c = await getOctokit().rest.repos.getCommit({
      owner: repo.owner,
      repo: repo.repo,
      ref: sha,
    });
    dateIso = c.data.commit.committer?.date ?? c.data.commit.author?.date ?? null;
  } catch {
    return NextResponse.json({ error: "That version couldn't be found on GitHub." }, { status: 404 });
  }
  const when = friendlyDate(dateIso);

  try {
    if (body.file) {
      /* ---------------- single file ---------------- */
      const file = body.file.trim();
      if (!FILE_RE.test(file)) {
        return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
      }
      const path = `${WORKFLOWS_DIR}/${file}`;
      const oldContent = await getFileContent(path, sha, repo);
      if (oldContent === null) {
        return NextResponse.json(
          { error: "That file didn't exist yet at that version, so there's nothing to restore." },
          { status: 404 },
        );
      }
      const currentContent = await getFileContent(path, "main", repo);
      if (currentContent === oldContent) {
        return NextResponse.json(
          { error: "The current version is already identical to that one." },
          { status: 400 },
        );
      }
      const label = AGENTS.find((a) => a.file === file)?.label.replace(/^@/, "") ?? file;
      const res = await commitFile(
        path,
        oldContent,
        `dashboard: restore ${label} instructions to version from ${when}`,
        { repo },
      );
      const commitUrl =
        (res as { commit?: { html_url?: string } }).commit?.html_url ??
        `https://github.com/${repo.owner}/${repo.repo}/commits/main/${path}`;
      return NextResponse.json({ ok: true, commitUrl });
    }

    /* ---------------- whole loop ---------------- */
    const [then, now] = await Promise.all([
      snapshotWorkflows(sha, repo),
      snapshotWorkflows("main", repo),
    ]);

    const changes: TreeChange[] = [];
    // Files that existed at that commit: put their content back if it differs.
    for (const [name, content] of then) {
      if (now.get(name) !== content) {
        changes.push({ path: `${WORKFLOWS_DIR}/${name}`, content });
      }
    }
    // Files added since then: remove them so the set matches exactly.
    for (const name of now.keys()) {
      if (!then.has(name)) {
        changes.push({ path: `${WORKFLOWS_DIR}/${name}`, content: null });
      }
    }
    if (changes.length === 0) {
      return NextResponse.json(
        { error: "The workflows are already identical to that version." },
        { status: 400 },
      );
    }

    const res = await atomicCommit(
      changes,
      `dashboard: restore all loop workflows to version from ${when}`,
      repo,
    );
    return NextResponse.json({ ok: true, commitUrl: res.url });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 409 || status === 422) {
      return NextResponse.json(
        { error: "Something changed on GitHub at the same time. Try the restore again." },
        { status: 409 },
      );
    }
    console.error("history/restore: failed", err);
    return NextResponse.json({ error: "Couldn't restore. Try again." }, { status: 502 });
  }
}
