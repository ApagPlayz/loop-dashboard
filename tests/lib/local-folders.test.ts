import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  LOW_SIGNAL_FILE_COUNT,
  folderId,
  isLowSignalFolder,
  resolveScannedFolder,
  scanLocalFolders,
  type LocalFolder,
} from "../../lib/local-folders";

/**
 * Two things are being pinned here.
 *
 * The first is the collision the multi-root picker introduced: the bare folder
 * NAME used to identify a candidate, and two roots can each hold a `Resume`.
 * A scan has to give them different ids, and asking to set one up has to get
 * that one and not the other.
 *
 * The second is the noise filter, which is only ever allowed to be a hint —
 * every folder found stays in the scan result, flagged, so the launchers'
 * checkout lookup and the resolve-before-acting guard are unaffected by it.
 *
 * As in the roots suite, everything runs against a scratch $HOME (see
 * lib/local-roots.ts on why that works). `scanLocalFolders` also asks GitHub
 * for the project registry to mark already-onboarded folders; that call has no
 * credentials here, fails, and is swallowed by the scan's own `.catch` — the
 * folders still come back, just with `onDashboard: false` throughout.
 */
const ENV_KEYS = ["HOME", "CLAUDE_PROJECTS_DIR", "LOOP_DASHBOARD_LOCAL_ROOTS_FILE"] as const;
let original: Record<(typeof ENV_KEYS)[number], string | undefined>;
let home: string;
let rootA: string;
let rootB: string;

/** Create `<parent>/<name>` holding `fileCount` throwaway files. */
async function makeFolder(parent: string, name: string, fileCount: number): Promise<string> {
  const dir = path.join(parent, name);
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    await fs.writeFile(path.join(dir, `file-${i}.txt`), "x", "utf-8");
  }
  return dir;
}

function byName(folders: LocalFolder[], name: string): LocalFolder[] {
  return folders.filter((f) => f.name === name);
}

beforeEach(async () => {
  original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as typeof original;
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "loop-folders-")));
  process.env.HOME = home;
  delete process.env.CLAUDE_PROJECTS_DIR;

  rootA = path.join(home, "Projects");
  rootB = path.join(home, "Code");
  await fs.mkdir(rootA, { recursive: true });
  await fs.mkdir(rootB, { recursive: true });

  const storeFile = path.join(home, ".loop-dashboard/local-roots.json");
  process.env.LOOP_DASHBOARD_LOCAL_ROOTS_FILE = storeFile;
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  await fs.writeFile(storeFile, JSON.stringify({ roots: [rootA, rootB] }), "utf-8");
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  await fs.rm(home, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

describe("folder ids", () => {
  test("are stable for a path and different for different paths", () => {
    expect(folderId("/a/Resume")).toBe(folderId("/a/Resume"));
    expect(folderId("/a/Resume")).not.toBe(folderId("/b/Resume"));
    expect(folderId("/a/Resume")).toMatch(/^[0-9a-f]{12}$/);
  });

  test("never carry a filesystem path back to the browser", () => {
    const id = folderId("/Users/someone/Projects/Resume");
    expect(id).not.toContain("/");
    expect(id).not.toContain("Resume");
  });
});

describe("scanning several roots", () => {
  test("lists both roots, grouped and labelled", async () => {
    await makeFolder(rootA, "alpha", 20);
    await makeFolder(rootB, "beta", 20);

    const scan = await scanLocalFolders();
    expect(scan.localUnavailable).toBe(false);
    expect(scan.roots.map((r) => r.display)).toEqual(["~/Projects", "~/Code"]);

    // Roots in the owner's order, folders alphabetical within each.
    expect(scan.folders.map((f) => `${f.rootLabel}/${f.name}`)).toEqual([
      "~/Projects/alpha",
      "~/Code/beta",
    ]);
  });

  test("gives the same folder name in two roots two different ids", async () => {
    const a = await makeFolder(rootA, "Resume", 20);
    const b = await makeFolder(rootB, "Resume", 20);

    const scan = await scanLocalFolders();
    const both = byName(scan.folders as LocalFolder[], "Resume");
    expect(both).toHaveLength(2);
    expect(both[0].id).not.toBe(both[1].id);
    expect(new Set(both.map((f) => f.path))).toEqual(new Set([a, b]));
  });

  test("resolves each of those ids to the right folder", async () => {
    const a = await makeFolder(rootA, "Resume", 20);
    const b = await makeFolder(rootB, "Resume", 20);

    // Resolve by id, not by name — the whole point of the id.
    expect((await resolveScannedFolder(folderId(a)))?.path).toBe(a);
    expect((await resolveScannedFolder(folderId(b)))?.path).toBe(b);
  });

  test("keeps going when one root has gone missing", async () => {
    await makeFolder(rootA, "alpha", 20);
    await fs.rm(rootB, { recursive: true, force: true });

    const scan = await scanLocalFolders();
    expect(scan.localUnavailable).toBe(false);
    expect(scan.folders.map((f) => f.name)).toEqual(["alpha"]);
    expect(scan.roots.find((r) => r.path === rootB)?.missing).toBe(true);
  });

  test("reports localUnavailable only when no root can be read at all", async () => {
    await fs.rm(rootA, { recursive: true, force: true });
    await fs.rm(rootB, { recursive: true, force: true });

    const scan = await scanLocalFolders();
    expect(scan.localUnavailable).toBe(true);
    expect(scan.folders).toEqual([]);
    // The roots still come back, so the picker can offer a way to fix it.
    expect(scan.roots).toHaveLength(2);
  });
});

describe("resolveScannedFolder", () => {
  test("rejects traversal and anything that isn't an id", async () => {
    await makeFolder(rootA, "Resume", 20);
    for (const bad of ["", "  ", "..", "../../etc", "Resume", "/etc/passwd", "ZZZZZZZZZZZZ", "abc"]) {
      expect(await resolveScannedFolder(bad), `${bad} should be refused`).toBeNull();
    }
  });

  test("rejects a well-formed id for a folder that isn't in the scan", async () => {
    await makeFolder(rootA, "Resume", 20);
    // Right shape, real directory — but outside every configured root.
    const outside = await makeFolder(home, "Elsewhere", 20);
    expect(await resolveScannedFolder(folderId(outside))).toBeNull();
  });

  test("still resolves a folder the picker would have hidden as noise", async () => {
    // The filter is a display hint. If the owner switches "show all" on and
    // picks one, the server must not then refuse it.
    const tiny = await makeFolder(rootA, "cooking", 3);
    const scan = await scanLocalFolders();
    expect(byName(scan.folders as LocalFolder[], "cooking")[0].lowSignal).toBe(true);
    expect((await resolveScannedFolder(folderId(tiny)))?.path).toBe(tiny);
  });
});

describe("the noise filter", () => {
  test("hides a small folder with no git repo and no stack", () => {
    expect(isLowSignalFolder({ isGitRepo: false, stack: [], fileCount: 3 })).toBe(true);
    expect(isLowSignalFolder({ isGitRepo: false, stack: [], fileCount: 0 })).toBe(true);
  });

  test("keeps anything with a git repo or a recognised stack, however small", () => {
    expect(isLowSignalFolder({ isGitRepo: true, stack: [], fileCount: 1 })).toBe(false);
    expect(isLowSignalFolder({ isGitRepo: false, stack: ["Python"], fileCount: 1 })).toBe(false);
  });

  test("keeps a folder that's simply big", () => {
    expect(
      isLowSignalFolder({ isGitRepo: false, stack: [], fileCount: LOW_SIGNAL_FILE_COUNT }),
    ).toBe(false);
    expect(isLowSignalFolder({ isGitRepo: false, stack: [], fileCount: 500 })).toBe(false);
  });

  test("flags real folders on disk without dropping any of them", async () => {
    await makeFolder(rootA, "cooking", 3); // noise
    await makeFolder(rootA, "notes", 6); // noise
    await makeFolder(rootA, "big-thing", 40); // plenty of files
    const site = await makeFolder(rootA, "tiny-site", 1); // recognised stack
    await fs.writeFile(path.join(site, "index.html"), "<!doctype html>", "utf-8");
    const repo = await makeFolder(rootB, "fresh-idea", 2); // git repo
    await fs.mkdir(path.join(repo, ".git"), { recursive: true });

    const scan = await scanLocalFolders();
    const flagged = Object.fromEntries(scan.folders.map((f) => [f.name, f.lowSignal]));

    expect(flagged).toEqual({
      cooking: true,
      notes: true,
      "big-thing": false,
      "tiny-site": false,
      "fresh-idea": false,
    });
    // Nothing was removed — five in, five out.
    expect(scan.folders).toHaveLength(5);
  });
});
