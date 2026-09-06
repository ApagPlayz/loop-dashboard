import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  RING_CAPACITY,
  getRecentUsage,
  makeUsageRecord,
  recordUsageFrom,
  resetUsage,
  summarizeUsage,
  type AiUsageRecord,
  type MakeUsageInput,
} from "../../lib/ai-usage";
import { findDemoFixture } from "../../lib/demo/api-fixtures";
import { isAlwaysPublic } from "../../lib/public-access";

/**
 * Every test here records usage, and recording persists. USAGE_STORE=off keeps
 * the suite from appending to the repo's real data/ai-usage.jsonl — the store's
 * own file behaviour is covered in usage-store.test.ts against a temp path.
 */
const USAGE_ENV_KEYS = ["USAGE_STORE", "USAGE_STORE_PATH"] as const;
let original: Record<(typeof USAGE_ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  original = Object.fromEntries(USAGE_ENV_KEYS.map((k) => [k, process.env[k]])) as typeof original;
  process.env.USAGE_STORE = "off";
  delete process.env.USAGE_STORE_PATH;
  resetUsage();
});

afterEach(() => {
  for (const k of USAGE_ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  resetUsage();
});

/** A record with everything filled in, for grouping tests. */
function rec(over: Partial<MakeUsageInput> = {}): AiUsageRecord {
  return makeUsageRecord({
    label: "test",
    backend: "api",
    kind: "structured",
    model: "claude-sonnet-5",
    tokens: { inputTokens: 100, outputTokens: 50 },
    durationMs: 10,
    ok: true,
    ...over,
  });
}

/* ------------------------------------------------------------------ */
/* totalInputTokens — the field the whole exercise turns on            */
/* ------------------------------------------------------------------ */

describe("makeUsageRecord: totalInputTokens", () => {
  test("sums uncached input, cache reads and cache writes", () => {
    const r = makeUsageRecord({
      backend: "api",
      kind: "structured",
      model: "claude-sonnet-5",
      tokens: {
        inputTokens: 12,
        outputTokens: 613,
        cacheReadTokens: 20_480,
        cacheWriteTokens: 4_096,
      },
      durationMs: 1,
      ok: true,
    });
    // 12 + 20480 + 4096 — NOT 12. `input_tokens` is the uncached remainder, so
    // anything reading it alone under-reports the prompt by three orders of
    // magnitude the moment caching is switched on.
    expect(r.totalInputTokens).toBe(24_588);
    expect(r.inputTokens).toBe(12);
  });

  test("equals inputTokens exactly when no caching happened", () => {
    const r = rec({});
    expect(r.totalInputTokens).toBe(r.inputTokens);
    expect(r.totalInputTokens).toBe(100);
  });

  test("treats absent and negative buckets as zero rather than NaN", () => {
    const r = makeUsageRecord({
      backend: "cli",
      kind: "chat",
      model: "sonnet",
      tokens: { inputTokens: -5, cacheReadTokens: undefined },
      durationMs: 0,
      ok: true,
    });
    expect(r.totalInputTokens).toBe(0);
    expect(Number.isNaN(r.totalInputTokens)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* makeUsageRecord — the rest of the contract                          */
/* ------------------------------------------------------------------ */

describe("makeUsageRecord", () => {
  test("defaults an unset or blank label to 'unknown'", () => {
    expect(rec({ label: undefined }).label).toBe("unknown");
    expect(rec({ label: "   " }).label).toBe("unknown");
  });

  test("normalizes the model id so a Bedrock call groups with its canonical one", () => {
    expect(rec({ model: "us.anthropic.claude-sonnet-5" }).model).toBe("claude-sonnet-5");
    expect(rec({ model: undefined }).model).toBe("unknown");
  });

  test("prices from the table when the backend reported no dollar figure", () => {
    const r = makeUsageRecord({
      backend: "api",
      kind: "structured",
      model: "claude-sonnet-5",
      tokens: { inputTokens: 1_000_000, outputTokens: 0 },
      durationMs: 1,
      ok: true,
    });
    expect(r.costUsd).toBeCloseTo(2, 10);
  });

  test("prefers a backend-reported cost over the price table", () => {
    const r = makeUsageRecord({
      backend: "cli",
      kind: "structured",
      model: "claude-sonnet-5",
      tokens: { inputTokens: 1_000_000 },
      costUsd: 0.0413,
      durationMs: 1,
      ok: true,
    });
    expect(r.costUsd).toBe(0.0413);
  });

  test("always stamps costBasis 'list' — never a claim of real spend", () => {
    expect(rec().costBasis).toBe("list");
  });

  test("carries an errorKind only on failures", () => {
    expect(rec({ ok: true }).errorKind).toBeUndefined();
    const failed = makeUsageRecord({
      backend: "api",
      kind: "chat",
      durationMs: 3,
      ok: false,
      errorKind: "http-429",
    });
    expect(failed.errorKind).toBe("http-429");
    const unlabelled = makeUsageRecord({ backend: "api", kind: "chat", durationMs: 3, ok: false });
    expect(unlabelled.errorKind).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ */
/* The ring buffer                                                     */
/* ------------------------------------------------------------------ */

describe("the in-memory ring", () => {
  test(`holds at most ${RING_CAPACITY} records, dropping the oldest`, () => {
    for (let i = 0; i < RING_CAPACITY + 100; i += 1) {
      recordUsageFrom({
        label: `call-${i}`,
        backend: "api",
        kind: "chat",
        model: "claude-sonnet-5",
        durationMs: 1,
        ok: true,
      });
    }
    const held = getRecentUsage();
    expect(held).toHaveLength(RING_CAPACITY);
    // Newest first, and the first 100 are gone.
    expect(held[0].label).toBe(`call-${RING_CAPACITY + 99}`);
    expect(held[held.length - 1].label).toBe("call-100");
    expect(held.some((r) => r.label === "call-99")).toBe(false);
  });

  test("getRecentUsage(limit) returns the newest `limit` records, newest first", () => {
    for (const label of ["a", "b", "c"]) {
      recordUsageFrom({ label, backend: "api", kind: "chat", durationMs: 1, ok: true });
    }
    expect(getRecentUsage(2).map((r) => r.label)).toEqual(["c", "b"]);
    expect(getRecentUsage().map((r) => r.label)).toEqual(["c", "b", "a"]);
  });

  test("resetUsage empties it", () => {
    recordUsageFrom({ backend: "api", kind: "chat", durationMs: 1, ok: true });
    expect(getRecentUsage()).toHaveLength(1);
    resetUsage();
    expect(getRecentUsage()).toHaveLength(0);
  });

  test("recording never throws, whatever it is handed", () => {
    // A telemetry bug must not be able to fail a real AI call.
    expect(() =>
      recordUsageFrom({
        backend: "api",
        kind: "chat",
        model: undefined,
        tokens: { inputTokens: Number.NaN },
        durationMs: Number.POSITIVE_INFINITY,
        ok: true,
      }),
    ).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* summarizeUsage                                                      */
/* ------------------------------------------------------------------ */

describe("summarizeUsage", () => {
  const records = [
    rec({
      label: "map-draft",
      model: "claude-opus-5",
      backend: "bedrock",
      tokens: { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 500 },
      durationMs: 1_000,
    }),
    rec({
      label: "map-draft",
      model: "claude-sonnet-5",
      backend: "api",
      tokens: { inputTokens: 200, outputTokens: 20 },
      durationMs: 200,
    }),
    rec({
      label: "help-assistant",
      model: "claude-sonnet-5",
      backend: "api",
      tokens: { inputTokens: 50, outputTokens: 5 },
      durationMs: 50,
      ok: false,
      errorKind: "http-429",
    }),
  ];

  test("totals every bucket across the whole set", () => {
    const { totals } = summarizeUsage(records);
    expect(totals.calls).toBe(3);
    expect(totals.ok).toBe(2);
    expect(totals.failed).toBe(1);
    expect(totals.inputTokens).toBe(1_250);
    expect(totals.outputTokens).toBe(125);
    expect(totals.cacheReadTokens).toBe(500);
    expect(totals.totalInputTokens).toBe(1_750); // 1250 uncached + 500 cache reads
    expect(totals.totalTokens).toBe(1_875);
    expect(totals.durationMs).toBe(1_250);
  });

  test("groups by label, and the groups add back up to the totals", () => {
    const summary = summarizeUsage(records);
    expect(summary.byLabel.map((g) => g.label).sort()).toEqual(["help-assistant", "map-draft"]);

    const draft = summary.byLabel.find((g) => g.label === "map-draft")!;
    expect(draft.calls).toBe(2);
    expect(draft.totalInputTokens).toBe(1_700);

    const summed = summary.byLabel.reduce((n, g) => n + g.costUsd, 0);
    expect(summed).toBeCloseTo(summary.totals.costUsd, 10);
  });

  test("groups by model and by backend", () => {
    const summary = summarizeUsage(records);
    const sonnet = summary.byModel.find((g) => g.model === "claude-sonnet-5")!;
    expect(sonnet.calls).toBe(2);
    expect(summary.byModel.find((g) => g.model === "claude-opus-5")!.calls).toBe(1);
    expect(summary.byBackend.find((g) => g.backend === "api")!.calls).toBe(2);
    expect(summary.byBackend.find((g) => g.backend === "bedrock")!.calls).toBe(1);
  });

  test("orders every breakdown most-expensive-first", () => {
    const summary = summarizeUsage(records);
    for (const groups of [summary.byLabel, summary.byModel, summary.byBackend]) {
      const costs = groups.map((g) => g.costUsd);
      expect([...costs].sort((a, b) => b - a)).toEqual(costs);
    }
  });

  test("reports the time span covered", () => {
    const summary = summarizeUsage([
      rec({ ts: "2026-09-01T00:00:00.000Z" }),
      rec({ ts: "2026-09-05T00:00:00.000Z" }),
      rec({ ts: "2026-09-03T00:00:00.000Z" }),
    ]);
    expect(summary.since).toBe("2026-09-01T00:00:00.000Z");
    expect(summary.until).toBe("2026-09-05T00:00:00.000Z");
  });

  test("an empty set summarizes to zeroes rather than throwing", () => {
    const summary = summarizeUsage([]);
    expect(summary.totals.calls).toBe(0);
    expect(summary.totals.costUsd).toBe(0);
    expect(summary.byLabel).toEqual([]);
    expect(summary.since).toBeNull();
    expect(summary.until).toBeNull();
  });

  test("restates costBasis on the summary so a consumer cannot miss it", () => {
    expect(summarizeUsage(records).costBasis).toBe("list");
  });
});

/* ------------------------------------------------------------------ */
/* /api/usage must stay private                                        */
/* ------------------------------------------------------------------ */

describe("/api/usage exposure", () => {
  test("is not in the always-public allowlist, on any method", () => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(isAlwaysPublic("/api/usage", method)).toBe(false);
    }
  });

  test("has no demo fixture, so the proxy 403s an anonymous caller", () => {
    // Spend shape leaks what the owner has been working on. There is no
    // anonymous version of this route — deny-by-default in proxy.ts is the
    // whole guard, and this asserts nothing has been added to bypass it.
    for (const method of ["GET", "HEAD", "POST"]) {
      expect(findDemoFixture("/api/usage", method)).toBeNull();
    }
  });
});
