/**
 * Which directories the "add a project → a local folder" picker scans.
 *
 * The picker used to look in exactly one place: `CLAUDE_PROJECTS_DIR`, or
 * `~/Documents/Claude Projects` when that isn't set. That's fine until the
 * owner keeps work in more than one place — a `~/Code` checkout tree, a
 * university folder, an old projects directory — at which point the only way
 * to onboard a folder was to move it. This module holds the editable list of
 * root directories the scan walks, and the validation that decides whether a
 * path the browser typed is allowed to become one.
 *
 * ## Why this does NOT live in config/projects.json
 *
 * The project registry is stored in the dashboard's own GitHub repo and read
 * back through the GitHub API, so every machine that runs the dashboard sees
 * the same file. These roots are the opposite kind of data: absolute paths
 * that mean something on exactly ONE Mac. `/Users/alessio/Code` is not a
 * setting, it is a fact about a filesystem — committing it would push one
 * laptop's directory layout to every deploy, and a container would then carry
 * a list of roots none of which exist. Worse, it would publish the shape of
 * the owner's home directory to anyone who can read the repo.
 *
 * So the list is machine-scoped: a small JSON file under `~/.loop-dashboard/`,
 * created on demand, never committed, never synced. `LOOP_DASHBOARD_LOCAL_ROOTS_FILE`
 * points it somewhere else (tests, and anyone running the dashboard under a
 * service account with a different home).
 *
 * ## The default root
 *
 * `CLAUDE_PROJECTS_DIR` (or `~/Documents/Claude Projects`) is the SEED: it is
 * what {@link readRootPaths} returns when the store file is missing, empty,
 * unreadable or corrupt, which means the picker keeps working exactly as it
 * did before anyone touches this feature. Once the file exists and parses, it
 * is authoritative — otherwise "remove this root" could not mean anything for
 * the default one. Removal still can't leave the list empty.
 *
 * ## What is NOT trusted
 *
 * Every path here arrives from a text input in the browser. Nothing in this
 * module hands a caller-supplied path to `fs` before it has been resolved,
 * symlink-canonicalised, and proven to sit inside the user's home directory —
 * see {@link addRoot}. A root is the boundary the rest of the local-folder
 * code trusts, so this is the one place that boundary gets drawn.
 */

import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

/** A configured scan root, as the API and the UI see it. */
export type LocalRoot = {
  /** Absolute, symlink-resolved path on disk. The id used to remove it. */
  path: string;
  /** The same path with the home directory collapsed to `~`, for display. */
  display: string;
  /** Whether this is the seed root (CLAUDE_PROJECTS_DIR / the default). */
  isDefault: boolean;
  /** True when the directory no longer exists or can't be read right now. */
  missing: boolean;
};

/** Result of an add/remove attempt. Never throws for a user-input problem —
 * the route turns `ok: false` into a 400 with `error` shown inline. */
export type RootMutation = { ok: true; roots: LocalRoot[] } | { ok: false; error: string };

/**
 * The home directory, read on every call rather than captured at module load.
 * `os.homedir()` consults `$HOME` on POSIX, and reading it lazily is what lets
 * the tests point an entire scenario at a scratch directory.
 */
function homeDir(): string {
  return os.homedir();
}

/** Expand a leading `~` so the owner can type the path the way they say it. */
export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homeDir();
  if (trimmed.startsWith("~/")) return path.join(homeDir(), trimmed.slice(2));
  return trimmed;
}

/** Collapse the home directory back to `~` for display. */
export function abbreviateHome(p: string): string {
  const home = homeDir();
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length);
  return p;
}

/**
 * The seed root: `CLAUDE_PROJECTS_DIR` when set, otherwise a portable
 * `~/Documents/Claude Projects` rather than one machine's literal path.
 * A function, not a constant, for the same lazy-`$HOME` reason as above.
 */
export function defaultProjectsDir(): string {
  const raw = (process.env.CLAUDE_PROJECTS_DIR ?? "").trim();
  return raw ? path.resolve(expandHome(raw)) : path.join(homeDir(), "Documents", "Claude Projects");
}

/** Where the machine-scoped list of roots is stored. */
export function rootsFilePath(): string {
  const override = (process.env.LOOP_DASHBOARD_LOCAL_ROOTS_FILE ?? "").trim();
  if (override) return path.resolve(expandHome(override));
  return path.join(homeDir(), ".loop-dashboard", "local-roots.json");
}

/**
 * Compare two paths for "is this the same directory".
 *
 * Deliberately case-insensitive. macOS's default filesystem is case-insensitive
 * (case-preserving), so `~/Code` and `~/code` are one directory and must not
 * both become roots — every folder inside would otherwise be listed twice under
 * two different ids. On a case-sensitive volume this is very slightly
 * over-strict: two genuinely distinct directories differing only in case can't
 * both be roots. That is the right trade for a personal tool on a Mac, and the
 * failure mode (a clear "already scanning that folder" message) is harmless.
 */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Whether `child` sits inside `parent` (strictly — not the same directory). */
export function isNestedWithin(child: string, parent: string): boolean {
  const c = child.toLowerCase();
  const p = parent.toLowerCase();
  return c !== p && c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * The configured root paths, in the owner's order. Always returns at least
 * one entry: a missing, empty, unreadable or malformed store file falls back
 * to the seed root, so a bad file degrades to "the behaviour you had before
 * this feature existed" rather than an empty picker.
 *
 * A corrupt file is NOT rewritten here. Reading is not the moment to destroy
 * something the owner might still be able to fix by hand; the next successful
 * add or remove replaces it.
 */
export async function readRootPaths(): Promise<string[]> {
  const fallback = [defaultProjectsDir()];

  let raw: string;
  try {
    raw = await fs.readFile(rootsFilePath(), "utf-8");
  } catch {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[local-roots] ${rootsFilePath()} isn't valid JSON; using the default root.`);
    return fallback;
  }

  const list = (parsed as { roots?: unknown })?.roots;
  if (!Array.isArray(list)) return fallback;

  // Drop anything that isn't a usable absolute path, and de-duplicate — the
  // file is on disk and could have been hand-edited into either state.
  //
  // The absoluteness test runs on the EXPANDED value, before `path.resolve`.
  // Resolving first would quietly turn a relative entry into a real path
  // relative to the server's cwd (the repo), so a stray `../..` in the file
  // would become a scan root somewhere nobody chose — the check has to happen
  // while "this isn't an absolute path" is still observable.
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const expanded = expandHome(entry);
    if (!path.isAbsolute(expanded)) continue;
    const p = path.resolve(expanded);
    if (out.some((existing) => samePath(existing, p))) continue;
    out.push(p);
  }
  return out.length > 0 ? out : fallback;
}

/** Whether a directory exists and can actually be listed. */
async function isReadableDir(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    if (!stat.isDirectory()) return false;
    // R_OK alone isn't enough: listing a directory needs the execute bit too.
    await fs.access(p, fsConstants.R_OK | fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The roots as the UI renders them, each annotated with whether it's the seed
 * root and whether it can be read right now. A root that has gone missing (an
 * unplugged drive, a folder that moved) is kept and flagged rather than
 * silently dropped — quietly deleting the owner's configuration because a disk
 * was unmounted would be a nasty surprise.
 */
export async function listRoots(): Promise<LocalRoot[]> {
  const paths = await readRootPaths();
  const seed = defaultProjectsDir();
  return Promise.all(
    paths.map(async (p) => ({
      path: p,
      display: abbreviateHome(p),
      isDefault: samePath(p, seed),
      missing: !(await isReadableDir(p)),
    })),
  );
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

async function writeRootPaths(paths: string[]): Promise<void> {
  const file = rootsFilePath();
  // 0o700 on the directory, 0o600 on the file: this describes the layout of
  // someone's home directory and there is no reason for another account on the
  // machine to be able to read it.
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify({ roots: paths }, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Validate and add a scan root.
 *
 * Every check here exists because the argument came from a text input in a
 * browser and will be handed to `fs.readdir` on every subsequent scan:
 *
 *   - absolute only — a relative path would resolve against the server's cwd,
 *     which is the repo, and mean something different from what was typed;
 *   - must exist, be a directory, and be listable — otherwise the root is a
 *     silent no-op and the owner is left wondering where their folders went;
 *   - canonicalised with `realpath` BEFORE the containment check, so a symlink
 *     inside the home directory can't be used to point a root at `/etc`;
 *   - inside the home directory, and not the home directory itself. `/`, `/usr`
 *     and `/System` are not places anyone keeps projects, and `~` itself is a
 *     junk drawer (Library, Applications, Downloads) that would flood the
 *     picker with dozens of non-projects;
 *   - not already a root, and not nested with an existing one in either
 *     direction — overlapping roots list the same folder twice under two ids.
 */
export async function addRoot(input: string): Promise<RootMutation> {
  const typed = (input ?? "").trim();
  if (!typed) return { ok: false, error: "Type the full path of a folder to scan." };

  const expanded = expandHome(typed);
  if (!path.isAbsolute(expanded)) {
    return {
      ok: false,
      error: `Use a full path starting with / or ~ — for example ${abbreviateHome(path.join(homeDir(), "Code"))}.`,
    };
  }

  const resolved = path.resolve(expanded);
  if (!(await isReadableDir(resolved))) {
    return { ok: false, error: `Couldn't read a folder at ${abbreviateHome(resolved)}. Check the path.` };
  }

  // Canonicalise before deciding whether it's inside home. Both the candidate
  // and home itself: a symlinked home would otherwise fail the prefix test.
  let real: string;
  let home: string;
  try {
    real = await fs.realpath(resolved);
    home = await fs.realpath(homeDir());
  } catch {
    return { ok: false, error: `Couldn't read a folder at ${abbreviateHome(resolved)}. Check the path.` };
  }

  if (samePath(real, home)) {
    return {
      ok: false,
      error: "That's your whole home folder — pick a folder inside it, like ~/Code, or the scan would list Library, Downloads and everything else.",
    };
  }
  if (!isNestedWithin(real, home)) {
    return { ok: false, error: "Pick a folder inside your home directory." };
  }

  const existing = await readRootPaths();
  for (const root of existing) {
    if (samePath(real, root)) {
      return { ok: false, error: `Already scanning ${abbreviateHome(root)}.` };
    }
    if (isNestedWithin(real, root)) {
      return {
        ok: false,
        error: `${abbreviateHome(real)} is already inside ${abbreviateHome(root)}, which is being scanned.`,
      };
    }
    if (isNestedWithin(root, real)) {
      return {
        ok: false,
        error: `${abbreviateHome(root)} is already being scanned and sits inside that folder. Remove it first.`,
      };
    }
  }

  await writeRootPaths([...existing, real]);
  return { ok: true, roots: await listRoots() };
}

/**
 * Remove a scan root. Refuses to leave the list empty: a picker with nowhere to
 * look is a broken feature, not a configuration, and there'd be no obvious way
 * back from it in the UI.
 */
export async function removeRoot(input: string): Promise<RootMutation> {
  const target = path.resolve(expandHome((input ?? "").trim()));
  const existing = await readRootPaths();

  if (!existing.some((root) => samePath(root, target))) {
    return { ok: false, error: "That folder isn't in the scan list." };
  }
  if (existing.length <= 1) {
    return { ok: false, error: "Add another folder first — the picker needs at least one place to look." };
  }

  await writeRootPaths(existing.filter((root) => !samePath(root, target)));
  return { ok: true, roots: await listRoots() };
}
