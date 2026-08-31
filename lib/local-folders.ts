/**
 * Local-folder scanning for the "start from a local folder" onboarding path.
 *
 * This is a LOCAL-ONLY feature: it reads the owner's Claude projects directory
 * on the machine the dashboard runs on. It does nothing useful on Vercel (the
 * folder won't exist there) — callers guard on `localUnavailable`.
 *
 * Nothing here mutates the filesystem; it only reads directory listings and a
 * few well-known files (package.json, git config) to describe each folder.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { listProjects, DASHBOARD_REPO } from "./projects";
import { isLocalModeEnabled } from "./local-mode";

const exec = promisify(execFile);

/** The default Claude projects directory, overridable for other machines. */
export const DEFAULT_PROJECTS_DIR = "/Users/alessiopagliarulo/Documents/Claude Projects";

export function getProjectsDir(): string {
  return (process.env.CLAUDE_PROJECTS_DIR ?? DEFAULT_PROJECTS_DIR).trim() || DEFAULT_PROJECTS_DIR;
}

/** Folders never offered as onboarding candidates (case-insensitive). */
const EXCLUDED_NAMES = new Set(["docs", "node_modules"]);
/** Directories skipped when counting files / never worth descending into. */
const SKIP_WALK_DIRS = new Set(["node_modules", ".git", ".next", ".turbo", "dist", "build"]);

export type LocalFolder = {
  /** Immediate subdirectory name (the id used to select it). */
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Suggested repo name if we create one on GitHub (kebab-cased). */
  suggestedRepo: string;
  isGitRepo: boolean;
  hasRemote: boolean;
  /** owner/repo parsed from the origin remote, when present. */
  remoteSlug: string | null;
  /** Rough count of source files (skips node_modules/.git/etc., capped). */
  fileCount: number;
  /** package.json "name", when present. */
  packageName: string | null;
  /** Plain-English stack hints, e.g. ["Node / JavaScript", "Next.js"]. */
  stack: string[];
  /** Already registered on the dashboard (matched by its GitHub remote). */
  onDashboard: boolean;
  /** Whether the wizard lets the owner pick it (false once onboarded). */
  selectable: boolean;
};

export type LocalScan =
  | { localUnavailable: true; baseDir: string; folders: [] }
  | { localUnavailable: false; baseDir: string; folders: LocalFolder[] };

/** kebab-case a folder name into a GitHub-legal repo slug. */
export function kebabCase(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w\s.-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .toLowerCase() || "project"
  );
}

/** Parse an owner/repo slug out of a git remote URL. */
function parseRemoteSlug(url: string): string | null {
  const trimmed = url.trim().replace(/\.git$/, "");
  // git@github.com:owner/repo  or  ssh://git@github.com/owner/repo
  const ssh = trimmed.match(/github\.com[:/]([^/]+)\/([^/]+)$/);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Origin remote slug for a git folder, or null if none / not readable. */
async function readRemoteSlug(dir: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["-C", dir, "remote", "get-url", "origin"], {
      timeout: 5_000,
    });
    return parseRemoteSlug(stdout);
  } catch {
    return null;
  }
}

const checkoutCache = new Map<string, { at: number; path: string | null }>();
const CHECKOUT_TTL_MS = 60_000;

/**
 * How a local checkout's git state compares to its remote-tracking branch —
 * i.e. whether "read the local checkout" and "read GitHub" describe the same
 * codebase right now. Deliberately NOT cached alongside {@link checkoutCache}:
 * that cache is only for the (slow, filesystem-scanning) path lookup, and its
 * 60s TTL would be fine for "which folder is this repo in" but wrong for
 * "is it dirty right now" — this is recomputed on every call.
 */
export type CheckoutStatus = {
  /** False when the path isn't a git repo at all (or git couldn't read it). */
  isGitRepo: boolean;
  /** Current branch name; null when detached HEAD or unreadable. */
  branch: string | null;
  /** Upstream tracking ref, e.g. "origin/main"; null when none is configured. */
  upstream: string | null;
  /** Commits on HEAD not on the upstream tracking ref. Null when there's no upstream. */
  ahead: number | null;
  /** Commits on the upstream tracking ref not on HEAD. Null when there's no upstream. */
  behind: number | null;
  /** Whether the working tree has uncommitted changes (modified, staged, or untracked). */
  dirty: boolean;
  /** Number of files `git status --porcelain` reports as changed. */
  dirtyFileCount: number;
  /**
   * Whether the LOCAL remote-tracking ref (refs/remotes/<remote>/<branch>) is
   * itself out of date with what's actually on the remote right now — i.e.
   * whether `ahead`/`behind` above might be understating true divergence
   * because this machine hasn't fetched recently. Checked with a read-only
   * `git ls-remote` (never writes local refs, never fetches objects). Null
   * when the check couldn't complete (no upstream, offline, timeout) — treat
   * that as "unknown", never as "not stale".
   */
  remoteStale: boolean | null;
};

const NOT_A_GIT_REPO: CheckoutStatus = {
  isGitRepo: false,
  branch: null,
  upstream: null,
  ahead: null,
  behind: null,
  dirty: false,
  dirtyFileCount: 0,
  remoteStale: null,
};

/** Run a git command in `dir`, returning trimmed stdout or null on any failure/timeout. */
async function runGit(dir: string, args: string[], timeoutMs = 5_000): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["-C", dir, ...args], { timeout: timeoutMs });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Read-only drift inspection for a local checkout: branch, ahead/behind vs
 * its upstream, working-tree dirtiness, and (unless `checkRemote` is false)
 * whether the local remote-tracking ref itself is stale.
 *
 * Never mutates anything — no `git fetch`, `pull`, `checkout`, or `reset`.
 * The only network call this makes, if any, is a single `git ls-remote`
 * (lists refs; does not download objects or write local state), guarded by
 * a short timeout so a slow/offline network degrades to `remoteStale: null`
 * instead of hanging the caller. Everything else is a fast local `git`
 * read (branch, rev-list, status) with no network involved.
 */
export async function getCheckoutStatus(
  dir: string,
  opts: { checkRemote?: boolean } = {},
): Promise<CheckoutStatus> {
  if (!(await pathExists(path.join(dir, ".git")))) return NOT_A_GIT_REPO;

  const branch = await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === null) return NOT_A_GIT_REPO; // .git exists but git couldn't read it

  const upstream = await runGit(dir, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);

  let ahead: number | null = null;
  let behind: number | null = null;
  if (upstream) {
    const counts = await runGit(dir, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    if (counts) {
      const [behindRaw, aheadRaw] = counts.split(/\s+/);
      const b = Number(behindRaw);
      const a = Number(aheadRaw);
      if (Number.isFinite(b) && Number.isFinite(a)) {
        behind = b;
        ahead = a;
      }
    }
  }

  const statusOut = await runGit(dir, ["status", "--porcelain"]);
  const dirtyFileCount = statusOut
    ? statusOut.split("\n").filter((line) => line.trim().length > 0).length
    : 0;

  let remoteStale: boolean | null = null;
  if (opts.checkRemote !== false && upstream) {
    const slash = upstream.indexOf("/");
    if (slash > 0) {
      const remoteName = upstream.slice(0, slash);
      const remoteBranch = upstream.slice(slash + 1);
      const [localSha, lsRemoteOut] = await Promise.all([
        runGit(dir, ["rev-parse", `refs/remotes/${remoteName}/${remoteBranch}`]),
        runGit(dir, ["ls-remote", remoteName, `refs/heads/${remoteBranch}`], 4_000),
      ]);
      const remoteSha = lsRemoteOut?.split(/\s+/)[0] || null;
      if (localSha && remoteSha) remoteStale = remoteSha !== localSha;
    }
  }

  return {
    isGitRepo: true,
    branch: branch === "HEAD" ? null : branch, // "HEAD" from rev-parse means detached
    upstream,
    ahead,
    behind,
    dirty: dirtyFileCount > 0,
    dirtyFileCount,
    remoteStale,
  };
}

/**
 * Absolute path to the local checkout of a GitHub repo (owner/repo), found by
 * scanning the projects directory and matching each folder's origin remote.
 * Returns null when no matching checkout exists on this machine (e.g. running
 * in the cloud, or the repo simply isn't cloned here). Cached ~60s per slug.
 *
 * This is what lets the local chat assistants actually READ a project's code
 * instead of guessing from issue/PR text alone.
 */
export async function localCheckoutForRepo(
  owner: string,
  repo: string,
): Promise<string | null> {
  // The chat assistants call this on every request. Off the owner's machine
  // there is no checkout to find, and looking for one means a directory scan
  // plus a `git` spawn per folder — so answer "no checkout" up front rather
  // than reaching for the host filesystem at all. Callers already handle null.
  if (!isLocalModeEnabled()) return null;

  const slug = `${owner}/${repo}`.toLowerCase();
  const hit = checkoutCache.get(slug);
  if (hit && Date.now() - hit.at < CHECKOUT_TTL_MS) return hit.path;

  const baseDir = getProjectsDir();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    checkoutCache.set(slug, { at: Date.now(), path: null });
    return null;
  }

  let found: string | null = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(baseDir, entry.name);
    const remote = await readRemoteSlug(dir);
    if (remote && remote.toLowerCase() === slug) {
      found = dir;
      break;
    }
  }
  checkoutCache.set(slug, { at: Date.now(), path: found });
  return found;
}

/** Bounded recursive file count, skipping heavy/generated directories. */
async function roughFileCount(dir: string, cap = 3000): Promise<number> {
  let count = 0;
  const stack: string[] = [dir];
  while (stack.length > 0 && count < cap) {
    const current = stack.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_WALK_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        stack.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        count++;
        if (count >= cap) break;
      }
    }
  }
  return count;
}

/** Read stack hints + package name for a folder (best-effort). */
async function detectStack(dir: string): Promise<{ packageName: string | null; stack: string[] }> {
  const stack: string[] = [];
  let packageName: string | null = null;

  const pkgRaw = await fs.readFile(path.join(dir, "package.json"), "utf-8").catch(() => null);
  if (pkgRaw) {
    stack.push("Node / JavaScript");
    try {
      const pkg = JSON.parse(pkgRaw) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      if (typeof pkg.name === "string") packageName = pkg.name;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) stack.push("Next.js");
      else if (deps.react) stack.push("React");
      if (deps.express || deps.fastify) stack.push("Node server");
      if (deps.typescript) stack.push("TypeScript");
    } catch {
      /* malformed package.json — the "Node / JavaScript" hint still stands */
    }
  }

  if (await pathExists(path.join(dir, "requirements.txt"))) stack.push("Python");
  else if (await pathExists(path.join(dir, "pyproject.toml"))) stack.push("Python");
  if (await pathExists(path.join(dir, "Cargo.toml"))) stack.push("Rust");
  if (await pathExists(path.join(dir, "go.mod"))) stack.push("Go");
  if (stack.length === 0 && (await pathExists(path.join(dir, "index.html")))) {
    stack.push("Static site");
  }

  return { packageName, stack };
}

/**
 * Scan the local projects directory for onboarding candidates. Excludes hidden
 * folders, `docs`, `node_modules`, and the Loop Dashboard's own checkout
 * (detected by its GitHub remote). Returns `localUnavailable` when the base
 * directory doesn't exist (e.g. running on Vercel).
 */
export async function scanLocalFolders(): Promise<LocalScan> {
  const baseDir = getProjectsDir();

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    return { localUnavailable: true, baseDir, folders: [] };
  }

  const projects = await listProjects().catch(() => []);
  const registered = new Set(projects.map((p) => `${p.owner}/${p.repo}`.toLowerCase()));
  const dashboardSlug = `${DASHBOARD_REPO.owner}/${DASHBOARD_REPO.repo}`.toLowerCase();

  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith(".") && !EXCLUDED_NAMES.has(e.name.toLowerCase()),
  );

  const folders = (
    await Promise.all(
      dirs.map(async (entry): Promise<LocalFolder | null> => {
        const dir = path.join(baseDir, entry.name);
        const isGitRepo = await pathExists(path.join(dir, ".git"));
        const remoteSlug = isGitRepo ? await readRemoteSlug(dir) : null;

        // Exclude the dashboard's own folder (identified by its remote, or by
        // the conventional folder name if it isn't a git checkout).
        if (
          (remoteSlug && remoteSlug.toLowerCase() === dashboardSlug) ||
          entry.name.toLowerCase() === "loop dashboard"
        ) {
          return null;
        }

        const [fileCount, { packageName, stack }] = await Promise.all([
          roughFileCount(dir),
          detectStack(dir),
        ]);

        const onDashboard = !!remoteSlug && registered.has(remoteSlug.toLowerCase());

        return {
          name: entry.name,
          path: dir,
          suggestedRepo: kebabCase(entry.name),
          isGitRepo,
          hasRemote: !!remoteSlug,
          remoteSlug,
          fileCount,
          packageName,
          stack,
          onDashboard,
          selectable: !onDashboard,
        };
      }),
    )
  ).filter((f): f is LocalFolder => f !== null);

  folders.sort((a, b) => a.name.localeCompare(b.name));
  return { localUnavailable: false, baseDir, folders };
}

/**
 * Resolve a folder the UI asked to initialize, rejecting anything that isn't a
 * currently-scanned, selectable immediate subdirectory (blocks path traversal
 * and already-onboarded folders). Returns null when it can't be used.
 */
export async function resolveScannedFolder(name: string): Promise<LocalFolder | null> {
  // Reject path separators / traversal outright before scanning.
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  const scan = await scanLocalFolders();
  if (scan.localUnavailable) return null;
  const folder = scan.folders.find((f) => f.name === name);
  if (!folder || !folder.selectable) return null;
  return folder;
}
