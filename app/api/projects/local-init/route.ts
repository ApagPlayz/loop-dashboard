import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getOctokit, type RepoConfig } from "@/lib/github";
import { installBaselineLoop, OnboardError } from "@/lib/onboard";
import { ProjectError } from "@/lib/projects";
import { resolveScannedFolder, kebabCase, type LocalFolder } from "@/lib/local-folders";
import { isLocalModeEnabled, localModeDisabledResponse } from "@/lib/local-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const exec = promisify(execFile);

/** A step the UI renders as a progress line. */
type Step = {
  key: string;
  label: string;
  status: "ok" | "skipped" | "error";
  detail?: string;
};

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Loop Dashboard",
  GIT_AUTHOR_EMAIL: "dashboard@local",
  GIT_COMMITTER_NAME: "Loop Dashboard",
  GIT_COMMITTER_EMAIL: "dashboard@local",
  // Never open an interactive credential/pager prompt from a request handler.
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
} as const;

const DEFAULT_GITIGNORE = `# Added by Loop Dashboard when first pushing this folder.
node_modules/
.env
.env.*
.next/
.DS_Store
`;

/** Run a git command inside `dir`, returning trimmed stdout. */
async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", dir, ...args], {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...GIT_ENV },
  });
  return stdout.trim();
}

/** Keep the access token out of anything we log or return to the browser. */
function redact(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("***");
}

function errText(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  return (e.stderr || e.message || String(err)).trim();
}

/**
 * POST /api/projects/local-init
 * Take a scanned local folder, get it onto GitHub (creating a private repo if
 * it has no remote yet), then run the SAME baseline onboarding as the existing
 * "add an existing repo" flow. Mutates the folder only after the user confirmed.
 *
 * Body: { folder: string, label?: string }
 * Returns: { ok, steps, project, commitUrl?, installed, skipped, labels }
 *
 * LOCAL-ONLY: this git-inits, commits and pushes a folder on the host, so it
 * 404s unless LOOP_DASHBOARD_LOCAL_MODE is on.
 */
export async function POST(req: Request) {
  if (!isLocalModeEnabled()) return localModeDisabledResponse();

  const token = process.env.GITHUB_TOKEN ?? "";
  const steps: Step[] = [];

  let body: { folder?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const name = (body.folder ?? "").trim();
  if (!name) return NextResponse.json({ error: "Pick a folder first." }, { status: 400 });

  // ----- resolve + guard (rejects traversal / already-onboarded) --------
  let folder: LocalFolder | null;
  try {
    folder = await resolveScannedFolder(name);
  } catch (err) {
    console.error("local-init: scan failed", err);
    return NextResponse.json({ error: "Couldn't read your local folders. Try again." }, { status: 502 });
  }
  if (!folder) {
    return NextResponse.json(
      { error: "That folder isn't available to set up (it may already be on the dashboard)." },
      { status: 400 },
    );
  }

  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN is not set on the server." }, { status: 500 });
  }

  const dir = folder.path;
  let target: RepoConfig;

  try {
    // ----- Step 1: get the folder onto GitHub --------------------------
    if (folder.hasRemote && folder.remoteSlug) {
      const [owner, repo] = folder.remoteSlug.split("/");
      target = { owner, repo };
      steps.push({
        key: "repo",
        label: "Use the folder's existing GitHub repo",
        status: "skipped",
        detail: `Already linked to ${folder.remoteSlug} — reusing it.`,
      });
    } else {
      // Create a fresh PRIVATE repo under the authenticated account.
      const repoName = kebabCase(folder.name);
      try {
        const created = (
          await getOctokit().rest.repos.createForAuthenticatedUser({
            name: repoName,
            private: true,
            description: "Set up from a local folder by the Loop Dashboard.",
          })
        ).data;
        target = { owner: created.owner.login, repo: created.name };
      } catch (err: unknown) {
        if ((err as { status?: number })?.status === 422) {
          return NextResponse.json(
            {
              error: `You already have a repository named "${repoName}" on GitHub. Rename the folder (or that repo) and try again.`,
              steps,
            },
            { status: 409 },
          );
        }
        throw err;
      }
      steps.push({
        key: "repo",
        label: "Create a private GitHub repo",
        status: "ok",
        detail: `Created ${target.owner}/${target.repo} (private).`,
      });

      // ----- Step 2: init / commit / push the folder -------------------
      const isRepo = await git(dir, ["rev-parse", "--is-inside-work-tree"]).then(
        () => true,
        () => false,
      );
      if (!isRepo) await git(dir, ["init"]);

      // Ensure a sensible .gitignore exists (create only if missing).
      const gitignorePath = path.join(dir, ".gitignore");
      let wroteIgnore = false;
      try {
        await fs.access(gitignorePath);
      } catch {
        await fs.writeFile(gitignorePath, DEFAULT_GITIGNORE, "utf-8");
        wroteIgnore = true;
      }

      await git(dir, ["add", "-A"]);
      const hasHead = await git(dir, ["rev-parse", "HEAD"]).then(
        () => true,
        () => false,
      );
      const dirty = (await git(dir, ["status", "--porcelain"]).catch(() => "")).length > 0;
      let committed = false;
      if (!hasHead || dirty) {
        await git(dir, [
          "-c",
          "user.name=Loop Dashboard",
          "-c",
          "user.email=dashboard@local",
          "commit",
          "-m",
          "Initial commit (set up by Loop Dashboard)",
        ]);
        committed = true;
      }

      // Point origin at the clean URL (token is NEVER written to git config).
      const cleanUrl = `https://github.com/${target.owner}/${target.repo}.git`;
      const hasOrigin = await git(dir, ["remote", "get-url", "origin"]).then(
        () => true,
        () => false,
      );
      await git(dir, hasOrigin ? ["remote", "set-url", "origin", cleanUrl] : ["remote", "add", "origin", cleanUrl]);

      // One-shot authenticated push — plain push only, never force.
      const pushUrl = `https://x-access-token:${token}@github.com/${target.owner}/${target.repo}.git`;
      await git(dir, ["push", pushUrl, "HEAD:main"]);

      const bits = [
        wroteIgnore ? "added a .gitignore" : null,
        committed ? "committed your files" : "nothing new to commit",
        "pushed to main",
      ].filter(Boolean);
      steps.push({
        key: "push",
        label: "Push the folder to GitHub",
        status: "ok",
        detail: bits.join(", ") + ".",
      });
    }

    // ----- Step 3: install the baseline loop (shared code path) --------
    const result = await installBaselineLoop(target, { label: body.label });
    steps.push({
      key: "loop",
      label: "Install the loop",
      status: "ok",
      detail: `${result.installed.length} file${result.installed.length === 1 ? "" : "s"} added${
        result.skipped.length ? `, ${result.skipped.length} left alone` : ""
      }.`,
    });

    return NextResponse.json({ ok: true, steps, ...result });
  } catch (err) {
    if (err instanceof OnboardError || err instanceof ProjectError) {
      steps.push({ key: "loop", label: "Install the loop", status: "error", detail: err.message });
      return NextResponse.json({ error: err.message, steps }, { status: err.httpStatus });
    }
    const detail = redact(errText(err), token);
    console.error("local-init: failed", detail);
    // Mark the in-flight step (the last one we hadn't resolved) as failed.
    steps.push({ key: "error", label: "Set the folder up on GitHub", status: "error", detail });
    return NextResponse.json(
      {
        error:
          "Couldn't finish setting the folder up. Some steps may have completed — check the repo on GitHub. Details: " +
          detail,
        steps,
      },
      { status: 502 },
    );
  }
}
