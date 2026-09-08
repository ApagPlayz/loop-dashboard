import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  abbreviateHome,
  addRoot,
  defaultProjectsDir,
  expandHome,
  isNestedWithin,
  listRoots,
  readRootPaths,
  removeRoot,
  rootsFilePath,
} from "../../lib/local-roots";

/**
 * The roots store is the trust boundary for the whole local-folder feature:
 * every path the scanner is ever allowed to read has to have survived
 * `addRoot`. So the interesting assertions here are the refusals.
 *
 * The whole suite runs against a scratch HOME. `os.homedir()` consults $HOME on
 * POSIX and lib/local-roots.ts reads it lazily for exactly this reason —
 * otherwise "must be inside the home directory" could only be tested against
 * the developer's real home directory, which is not a thing a test should be
 * writing into. The temp path is realpath'd up front because macOS's
 * `os.tmpdir()` is a symlink (/var → /private/var) and the store canonicalises
 * before comparing.
 */
const ENV_KEYS = ["HOME", "CLAUDE_PROJECTS_DIR", "LOOP_DASHBOARD_LOCAL_ROOTS_FILE"] as const;
let original: Record<(typeof ENV_KEYS)[number], string | undefined>;
let home: string;

/** Make `<home>/<name>` and return its absolute path. */
async function mkdir(name: string): Promise<string> {
  const dir = path.join(home, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Whatever is on disk in the store file right now. */
async function storedRoots(): Promise<string[]> {
  const raw = await fs.readFile(rootsFilePath(), "utf-8");
  return (JSON.parse(raw) as { roots: string[] }).roots;
}

beforeEach(async () => {
  original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as typeof original;
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "loop-roots-")));
  process.env.HOME = home;
  process.env.LOOP_DASHBOARD_LOCAL_ROOTS_FILE = path.join(home, ".loop-dashboard/local-roots.json");
  delete process.env.CLAUDE_PROJECTS_DIR;
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  await fs.rm(home, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

describe("the default root", () => {
  test("is the only root when nothing has been stored", async () => {
    expect(os.homedir()).toBe(home);
    expect(await readRootPaths()).toEqual([path.join(home, "Documents", "Claude Projects")]);
  });

  test("follows CLAUDE_PROJECTS_DIR", async () => {
    process.env.CLAUDE_PROJECTS_DIR = path.join(home, "Work");
    expect(defaultProjectsDir()).toBe(path.join(home, "Work"));
    expect(await readRootPaths()).toEqual([path.join(home, "Work")]);
  });

  test("survives a corrupt store file rather than leaving the picker blind", async () => {
    await fs.mkdir(path.dirname(rootsFilePath()), { recursive: true });
    await fs.writeFile(rootsFilePath(), "{ not json at all", "utf-8");
    expect(await readRootPaths()).toEqual([defaultProjectsDir()]);
  });

  test("survives a store file of the wrong shape, or an empty list", async () => {
    await fs.mkdir(path.dirname(rootsFilePath()), { recursive: true });
    for (const body of ['{"roots":"nope"}', '{"roots":[]}', '{"roots":[42,"relative/path"]}', "[]"]) {
      await fs.writeFile(rootsFilePath(), body, "utf-8");
      expect(await readRootPaths()).toEqual([defaultProjectsDir()]);
    }
  });

  test("is NOT force-added once a real list has been stored", async () => {
    // Otherwise "stop scanning the default folder" could never mean anything.
    const code = await mkdir("Code");
    await fs.mkdir(path.dirname(rootsFilePath()), { recursive: true });
    await fs.writeFile(rootsFilePath(), JSON.stringify({ roots: [code] }), "utf-8");
    expect(await readRootPaths()).toEqual([code]);
  });

  test("is flagged as the default, and as missing when it doesn't exist", async () => {
    const [root] = await listRoots();
    expect(root.isDefault).toBe(true);
    expect(root.missing).toBe(true); // ~/Documents/Claude Projects isn't there
    expect(root.display).toBe(path.join("~", "Documents", "Claude Projects"));
  });
});

describe("adding a root", () => {
  test("stores it, canonicalised, and reports it back", async () => {
    const code = await mkdir("Code");
    const result = await addRoot("~/Code");

    expect(result.ok).toBe(true);
    expect(await storedRoots()).toEqual([defaultProjectsDir(), code]);
    if (result.ok) {
      expect(result.roots.map((r) => r.display)).toEqual(["~/Documents/Claude Projects", "~/Code"]);
      expect(result.roots[1]).toMatchObject({ path: code, isDefault: false, missing: false });
    }
  });

  test("refuses a relative path", async () => {
    await mkdir("Code");
    const result = await addRoot("Code");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/full path/i);
  });

  test("refuses a path that isn't there", async () => {
    expect(await addRoot(path.join(home, "nope"))).toMatchObject({ ok: false });
  });

  test("refuses a file", async () => {
    const file = path.join(home, "notes.txt");
    await fs.writeFile(file, "hello", "utf-8");
    expect(await addRoot(file)).toMatchObject({ ok: false });
  });

  test("refuses anything outside the home directory", async () => {
    for (const outside of ["/", "/etc", "/usr", "/tmp", os.tmpdir()]) {
      const result = await addRoot(outside);
      expect(result.ok, `${outside} should be refused`).toBe(false);
    }
  });

  test("refuses the home directory itself", async () => {
    const result = await addRoot("~");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/home folder/i);
  });

  test("refuses a symlink that points out of the home directory", async () => {
    // The containment check runs on the realpath precisely so this can't work.
    await fs.symlink("/etc", path.join(home, "escape"));
    expect(await addRoot(path.join(home, "escape"))).toMatchObject({ ok: false });
    expect(await readRootPaths()).toEqual([defaultProjectsDir()]);
  });

  test("refuses a duplicate, including one that differs only in case", async () => {
    await mkdir("Code");
    expect(await addRoot("~/Code")).toMatchObject({ ok: true });

    const again = await addRoot("~/Code");
    expect(again).toMatchObject({ ok: false });
    if (!again.ok) expect(again.error).toMatch(/already scanning/i);

    // macOS's default filesystem is case-insensitive, so this is the same dir.
    expect(await addRoot("~/code")).toMatchObject({ ok: false });
    expect(await storedRoots()).toHaveLength(2);
  });

  test("refuses a folder nested inside an existing root", async () => {
    await mkdir("Code");
    await mkdir("Code/inner");
    expect(await addRoot("~/Code")).toMatchObject({ ok: true });

    const nested = await addRoot("~/Code/inner");
    expect(nested).toMatchObject({ ok: false });
    if (!nested.ok) expect(nested.error).toMatch(/already inside/i);
    expect(await storedRoots()).toHaveLength(2);
  });

  test("refuses a folder that would swallow an existing root", async () => {
    await mkdir("Code/inner");
    expect(await addRoot("~/Code/inner")).toMatchObject({ ok: true });

    const parent = await addRoot("~/Code");
    expect(parent).toMatchObject({ ok: false });
    if (!parent.ok) expect(parent.error).toMatch(/remove it first/i);
    expect(await storedRoots()).toHaveLength(2);
  });

  test("de-duplicates a hand-edited store file on read", async () => {
    const code = await mkdir("Code");
    await fs.mkdir(path.dirname(rootsFilePath()), { recursive: true });
    await fs.writeFile(rootsFilePath(), JSON.stringify({ roots: [code, code, "~/Code"] }), "utf-8");
    expect(await readRootPaths()).toEqual([code]);
  });
});

describe("removing a root", () => {
  test("removes one, leaving the rest", async () => {
    const code = await mkdir("Code");
    await addRoot("~/Code");

    const result = await removeRoot(defaultProjectsDir());
    expect(result).toMatchObject({ ok: true });
    expect(await readRootPaths()).toEqual([code]);
  });

  test("refuses to remove the last one", async () => {
    const result = await removeRoot(defaultProjectsDir());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/at least one/i);
    expect(await readRootPaths()).toEqual([defaultProjectsDir()]);
  });

  test("refuses a path that isn't a root", async () => {
    await mkdir("Code");
    await addRoot("~/Code");
    expect(await removeRoot(path.join(home, "Elsewhere"))).toMatchObject({ ok: false });
    expect(await readRootPaths()).toHaveLength(2);
  });
});

describe("path helpers", () => {
  test("expandHome and abbreviateHome round-trip", () => {
    expect(expandHome("~/Code")).toBe(path.join(home, "Code"));
    expect(expandHome("~")).toBe(home);
    expect(expandHome("/absolute")).toBe("/absolute");
    expect(abbreviateHome(path.join(home, "Code"))).toBe("~/Code");
    expect(abbreviateHome(home)).toBe("~");
    expect(abbreviateHome("/elsewhere")).toBe("/elsewhere");
  });

  test("isNestedWithin is strict, and not fooled by a shared name prefix", () => {
    expect(isNestedWithin("/a/b/c", "/a/b")).toBe(true);
    expect(isNestedWithin("/a/b", "/a/b")).toBe(false);
    expect(isNestedWithin("/a/bc", "/a/b")).toBe(false);
    expect(isNestedWithin("/a", "/a/b")).toBe(false);
  });
});
