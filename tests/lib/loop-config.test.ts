/**
 * `.github/loop-config.json` — the read/normalize/serialize round trip.
 *
 * The whole point of this file is what it must NOT do. The config is read at
 * runtime by workflows inside the target repo, so a key this version of the
 * dashboard doesn't happen to know about is still a live setting: dropping it
 * on save is a setting that quietly stops applying, with no error anywhere.
 * That has already bitten once at the top level (which is why `extra` exists)
 * and was still live one level down, inside the `scout` block, where
 * `claude-scout.yml` reads `scout.aiProvider`.
 *
 * Nothing here touches GitHub — only the pure normalize/serialize pair.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_STALE_CHECK_CONFIG,
  loopConfigFingerprint,
  normalizeLoopConfig,
  serializeLoopConfig,
} from "../../lib/loop-config";

/** normalize -> serialize -> re-parse, i.e. what a save really does. */
function roundTrip(raw: unknown): Record<string, unknown> {
  return JSON.parse(serializeLoopConfig(normalizeLoopConfig(raw)));
}

describe("defaults", () => {
  it("reads an empty file as the documented defaults", () => {
    const config = normalizeLoopConfig({});
    expect(config.autonomousBuildEnabled).toBe(false);
    expect(config.prCap).toBe(3);
    expect(config.ideaQueueCap).toBe(25);
    expect(config.scout.maxPerRun).toBe(3);
    // Opt-in means opt-in: nothing that writes comments to the owner's issues
    // may arrive switched on.
    expect(config.scout.staleCheck).toEqual(DEFAULT_STALE_CHECK_CONFIG);
    expect(config.scout.staleCheck.enabled).toBe(false);
  });

  it("omits the staleCheck key entirely while it is at its default", () => {
    // A repo that has never heard of this feature must round-trip
    // byte-identically. The workflow's `// false` fallback is what supplies the
    // default at run time — writing the key would only add noise to the diff.
    const out = roundTrip({}) as { scout: Record<string, unknown> };
    expect("staleCheck" in out.scout).toBe(false);
  });

  it("writes the block once it is switched on", () => {
    const out = roundTrip({ scout: { staleCheck: { enabled: true, intervalHours: 6 } } });
    expect((out.scout as Record<string, unknown>).staleCheck).toEqual({
      enabled: true,
      intervalHours: 6,
    });
  });

  it("keeps a non-default interval even when the check is switched off", () => {
    // Otherwise toggling off and on again silently resets the owner's choice
    // back to daily.
    const out = roundTrip({ scout: { staleCheck: { enabled: false, intervalHours: 6 } } });
    expect((out.scout as Record<string, unknown>).staleCheck).toEqual({
      enabled: false,
      intervalHours: 6,
    });
  });
});

describe("normalization of malformed values", () => {
  it("never turns the check on from a truthy non-boolean", () => {
    expect(normalizeLoopConfig({ scout: { staleCheck: { enabled: "yes" } } }).scout
      .staleCheck.enabled).toBe(false);
    expect(normalizeLoopConfig({ scout: { staleCheck: { enabled: 1 } } }).scout
      .staleCheck.enabled).toBe(false);
  });

  it("clamps the interval instead of rejecting it", () => {
    // A hand-edited 0 would mean "re-check on every hourly run" and, worse,
    // is a divide-by-zero away from an arithmetic failure in the bash gate.
    const zero = normalizeLoopConfig({ scout: { staleCheck: { intervalHours: 0 } } });
    expect(zero.scout.staleCheck.intervalHours).toBe(1);
    const huge = normalizeLoopConfig({ scout: { staleCheck: { intervalHours: 99999 } } });
    expect(huge.scout.staleCheck.intervalHours).toBe(168);
  });

  it("falls back to the default for a non-numeric interval", () => {
    const got = normalizeLoopConfig({ scout: { staleCheck: { intervalHours: "daily" } } });
    expect(got.scout.staleCheck.intervalHours).toBe(24);
  });

  it("survives a scout block that is not an object", () => {
    expect(normalizeLoopConfig({ scout: "nope" }).scout.staleCheck.enabled).toBe(false);
  });
});

describe("unknown keys survive a save", () => {
  it("keeps top-level keys this version doesn't model", () => {
    const out = roundTrip({ prCap: 5, aiProvider: "bedrock", somethingNew: [1, 2] });
    expect(out.aiProvider).toBe("bedrock");
    expect(out.somethingNew).toEqual([1, 2]);
    expect(out.prCap).toBe(5);
  });

  it("keeps unknown keys INSIDE the scout block", () => {
    // The live regression this covers: claude-scout.yml reads
    // `scout.aiProvider` to choose subscription vs Bedrock, and the dashboard
    // has never modelled it. Before scout-level `extra`, saving the brief from
    // the Ideas page was enough to switch a repo's Scout off Bedrock without
    // anyone touching that setting.
    const out = roundTrip({
      scout: { productSummary: "A thing", aiProvider: "bedrock", futureKey: true },
    }) as { scout: Record<string, unknown> };
    expect(out.scout.aiProvider).toBe("bedrock");
    expect(out.scout.futureKey).toBe(true);
    expect(out.scout.productSummary).toBe("A thing");
  });

  it("never lets a preserved key shadow one this file owns", () => {
    // `extra` is written first so a stale copy of a canonical key can't win.
    const config = normalizeLoopConfig({ prCap: 5 });
    config.extra = { prCap: 999 };
    config.scout.extra = { maxPerRun: 999 };
    const out = JSON.parse(serializeLoopConfig(config)) as {
      prCap: number;
      scout: { maxPerRun: number };
    };
    expect(out.prCap).toBe(5);
    expect(out.scout.maxPerRun).toBe(3);
  });

  it("is stable across a second round trip", () => {
    const raw = {
      prCap: "unlimited",
      demoPort: 4173,
      customThing: { a: 1 },
      scout: {
        productSummary: "  padded  ",
        lenses: ["one", "", "two"],
        aiProvider: "bedrock",
        staleCheck: { enabled: true, intervalHours: 6 },
      },
    };
    const once = serializeLoopConfig(normalizeLoopConfig(raw));
    const twice = serializeLoopConfig(normalizeLoopConfig(JSON.parse(once)));
    expect(twice).toBe(once);
  });
});

describe("fingerprints", () => {
  it("changes when a preserved unknown key changes", () => {
    // The fingerprint is the optimistic-concurrency check. If it ignored keys
    // this version doesn't know about, a concurrent edit to one of them would
    // be silently overwritten instead of conflicting.
    const a = normalizeLoopConfig({ scout: { aiProvider: "bedrock" } });
    const b = normalizeLoopConfig({ scout: { aiProvider: "subscription" } });
    expect(loopConfigFingerprint(a)).not.toBe(loopConfigFingerprint(b));
  });

  it("changes when the stale check is switched on", () => {
    const off = normalizeLoopConfig({});
    const on = normalizeLoopConfig({ scout: { staleCheck: { enabled: true } } });
    expect(loopConfigFingerprint(off)).not.toBe(loopConfigFingerprint(on));
  });
});
