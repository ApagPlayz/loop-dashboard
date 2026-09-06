import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { makeUsageRecord } from "../../lib/ai-usage";
import {
  DEFAULT_USAGE_PATH,
  appendUsage,
  flushUsageWrites,
  readUsageRecords,
  usageBucket,
  usageFilePath,
  usageStoreMode,
} from "../../lib/usage-store";

/**
 * The store is the one piece here that touches the disk, so it gets a scratch
 * directory of its own. USAGE_STORE_PATH is the same override a container would
 * use to point the log at a mounted volume.
 */
const ENV_KEYS = ["USAGE_STORE", "USAGE_STORE_PATH", "USAGE_STORE_BUCKET"] as const;
let original: Record<(typeof ENV_KEYS)[number], string | undefined>;
let dir: string;

beforeEach(async () => {
  original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as typeof original;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "loop-usage-store-"));
  process.env.USAGE_STORE = "local";
  process.env.USAGE_STORE_PATH = path.join(dir, "ai-usage.jsonl");
  delete process.env.USAGE_STORE_BUCKET;
});

afterEach(async () => {
  await flushUsageWrites();
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  await fs.rm(dir, { recursive: true, force: true });
});

function record(label: string) {
  return makeUsageRecord({
    label,
    backend: "api",
    kind: "structured",
    model: "claude-sonnet-5",
    tokens: { inputTokens: 100, outputTokens: 10 },
    durationMs: 5,
    ok: true,
  });
}

/* ------------------------------------------------------------------ */
/* Mode and location                                                   */
/* ------------------------------------------------------------------ */

describe("usageStoreMode", () => {
  test("defaults to local when nothing is set", () => {
    delete process.env.USAGE_STORE;
    expect(usageStoreMode()).toBe("local");
  });

  test("recognizes s3 and off", () => {
    process.env.USAGE_STORE = "s3";
    expect(usageStoreMode()).toBe("s3");
    process.env.USAGE_STORE = "off";
    expect(usageStoreMode()).toBe("off");
  });

  test("falls back to local on a typo rather than throwing on the request path", () => {
    // Unlike artifactStoreMode(), which throws: this one runs inside an AI call,
    // and a misspelled env var must not be able to take drafting down.
    process.env.USAGE_STORE = "s33";
    expect(usageStoreMode()).toBe("local");
  });
});

describe("usageFilePath", () => {
  test("defaults under the repo's data/ directory, not os.tmpdir()", () => {
    // tmpdir is wiped on every deploy, which would make "durable" a lie.
    delete process.env.USAGE_STORE_PATH;
    const file = usageFilePath();
    expect(path.isAbsolute(file)).toBe(true);
    expect(file.endsWith(DEFAULT_USAGE_PATH)).toBe(true);
    expect(file.startsWith(os.tmpdir())).toBe(false);
  });

  test("USAGE_STORE_PATH wins, absolute or repo-relative", () => {
    process.env.USAGE_STORE_PATH = "/var/log/usage.jsonl";
    expect(usageFilePath()).toBe("/var/log/usage.jsonl");
    process.env.USAGE_STORE_PATH = "somewhere/usage.jsonl";
    expect(path.isAbsolute(usageFilePath())).toBe(true);
    expect(usageFilePath().endsWith("somewhere/usage.jsonl")).toBe(true);
  });

  test("the mirror bucket defaults to the existing ML bucket", () => {
    expect(usageBucket()).toMatch(/^loop-dashboard-ml-/);
    process.env.USAGE_STORE_BUCKET = "some-other-bucket";
    expect(usageBucket()).toBe("some-other-bucket");
  });
});

/* ------------------------------------------------------------------ */
/* Appending and reading back                                          */
/* ------------------------------------------------------------------ */

describe("appendUsage", () => {
  test("writes one JSON object per line and reads it back intact", async () => {
    await appendUsage(record("first"));
    await appendUsage(record("second"));
    await flushUsageWrites();

    const raw = await fs.readFile(usageFilePath(), "utf-8");
    expect(raw.trim().split("\n")).toHaveLength(2);

    const back = await readUsageRecords();
    expect(back.map((r) => r.label)).toEqual(["first", "second"]);
    expect(back[0].totalInputTokens).toBe(100);
    expect(back[0].costBasis).toBe("list");
  });

  test("creates the directory it writes into", async () => {
    process.env.USAGE_STORE_PATH = path.join(dir, "nested", "deeper", "usage.jsonl");
    await appendUsage(record("nested"));
    await flushUsageWrites();
    expect((await readUsageRecords()).map((r) => r.label)).toEqual(["nested"]);
  });

  test("USAGE_STORE=off writes nothing at all", async () => {
    process.env.USAGE_STORE = "off";
    await appendUsage(record("ignored"));
    await flushUsageWrites();
    await expect(fs.stat(usageFilePath())).rejects.toThrow();
  });

  test("never rejects when the path cannot be written", async () => {
    // A telemetry write that can fail an AI call is worse than no telemetry.
    // Pointing at a path under an existing FILE guarantees an ENOTDIR.
    const blocker = path.join(dir, "blocker");
    await fs.writeFile(blocker, "not a directory");
    process.env.USAGE_STORE_PATH = path.join(blocker, "usage.jsonl");
    await expect(appendUsage(record("doomed"))).resolves.toBeUndefined();
  });

  test("concurrent appends all land, none interleave", async () => {
    const labels = Array.from({ length: 20 }, (_, i) => `call-${i}`);
    await Promise.all(labels.map((l) => appendUsage(record(l))));
    await flushUsageWrites();
    const back = await readUsageRecords();
    expect(back).toHaveLength(20);
    expect(back.map((r) => r.label).sort()).toEqual([...labels].sort());
  });
});

describe("readUsageRecords", () => {
  test("returns [] when the file does not exist", async () => {
    expect(await readUsageRecords()).toEqual([]);
  });

  test("skips a truncated final line instead of failing the whole read", async () => {
    await appendUsage(record("good"));
    await flushUsageWrites();
    // Simulate a process killed mid-append.
    await fs.appendFile(usageFilePath(), '{"ts":"2026-09-05T00:00:00.00', "utf-8");
    const back = await readUsageRecords();
    expect(back.map((r) => r.label)).toEqual(["good"]);
  });

  test("honours a limit, keeping the newest records", async () => {
    for (const l of ["a", "b", "c", "d"]) await appendUsage(record(l));
    await flushUsageWrites();
    expect((await readUsageRecords(2)).map((r) => r.label)).toEqual(["c", "d"]);
  });
});

/* ------------------------------------------------------------------ */
/* Rotation                                                            */
/* ------------------------------------------------------------------ */

describe("rotation", () => {
  test("rolls the file over once it passes the cap, keeping one generation", async () => {
    const file = usageFilePath();
    // Pre-fill past the 2 MB cap with valid lines, then append once more.
    const filler = JSON.stringify({ label: "filler" }) + "\n";
    await fs.writeFile(file, filler.repeat(Math.ceil((2 * 1024 * 1024) / filler.length) + 1));
    const sizeBefore = (await fs.stat(file)).size;
    expect(sizeBefore).toBeGreaterThan(2 * 1024 * 1024);

    await appendUsage(record("after-rotation"));
    await flushUsageWrites();

    // The live file now holds only the new record...
    const back = await readUsageRecords();
    expect(back).toHaveLength(1);
    expect(back[0].label).toBe("after-rotation");
    // ...and the previous generation is still on disk, not deleted.
    const rolled = file.replace(/\.jsonl$/, "") + ".1.jsonl";
    expect((await fs.stat(rolled)).size).toBe(sizeBefore);
  });

  test("does not rotate a file that is under the cap", async () => {
    await appendUsage(record("one"));
    await appendUsage(record("two"));
    await flushUsageWrites();
    expect(await readUsageRecords()).toHaveLength(2);
    const rolled = usageFilePath().replace(/\.jsonl$/, "") + ".1.jsonl";
    await expect(fs.stat(rolled)).rejects.toThrow();
  });
});
