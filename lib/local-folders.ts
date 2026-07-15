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
