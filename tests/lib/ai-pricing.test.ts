import { describe, expect, test } from "vitest";

import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_PRICES,
  costOf,
  normalizeModelId,
  priceFor,
} from "../../lib/ai-pricing";

/* ------------------------------------------------------------------ */
/* normalizeModelId — every spelling a model id reaches us in          */
/* ------------------------------------------------------------------ */

describe("normalizeModelId", () => {
  test("a canonical first-party id is returned unchanged", () => {
    expect(normalizeModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  test("strips the anthropic. provider prefix a Bedrock mantle id carries", () => {
    expect(normalizeModelId("anthropic.claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  test("strips an inference-profile prefix AND the provider prefix together", () => {
    // The case the accounting actually breaks on: a us.-profiled Bedrock id
    // would otherwise miss the price table entirely and cost $0.
    expect(normalizeModelId("us.anthropic.claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeModelId("eu.anthropic.claude-opus-5")).toBe("claude-opus-5");
    expect(normalizeModelId("global.anthropic.claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });

  test("strips a date-and-version suffix from a legacy invoke id", () => {
    expect(normalizeModelId("global.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(
      "claude-haiku-4-5",
    );
    expect(normalizeModelId("anthropic.claude-opus-4-6-v1")).toBe("claude-opus-4-6");
  });

  test("resolves the bare aliases the CLI is invoked with", () => {
    expect(normalizeModelId("sonnet")).toBe("claude-sonnet-5");
    expect(normalizeModelId("opus")).toBe("claude-opus-5");
    expect(normalizeModelId("haiku")).toBe("claude-haiku-4-5");
  });

  test("is case- and whitespace-insensitive", () => {
    expect(normalizeModelId("  US.Anthropic.Claude-Sonnet-5 ")).toBe("claude-sonnet-5");
  });

  test("does not mangle a version-looking model id into nothing", () => {
    // The suffix strip is anchored at the end and must never eat the whole id.
    expect(normalizeModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(normalizeModelId("")).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* priceFor                                                            */
/* ------------------------------------------------------------------ */

describe("priceFor", () => {
  test("every table entry has a positive input and output rate", () => {
    for (const [model, price] of Object.entries(MODEL_PRICES)) {
      expect(price.input, model).toBeGreaterThan(0);
      expect(price.output, model).toBeGreaterThan(0);
    }
  });

  test("a Bedrock-shaped id prices identically to its canonical id", () => {
    expect(priceFor("us.anthropic.claude-sonnet-5").price).toEqual(
      priceFor("claude-sonnet-5").price,
    );
  });

  test("an unknown model reports known:false and zero rates, not a neighbour's", () => {
    const lookup = priceFor("claude-does-not-exist-9");
    expect(lookup.known).toBe(false);
    expect(lookup.price).toEqual({ input: 0, output: 0 });
    // The normalized id is still reported, so the gap is nameable.
    expect(lookup.model).toBe("claude-does-not-exist-9");
  });
});

/* ------------------------------------------------------------------ */
/* costOf — the arithmetic                                             */
/* ------------------------------------------------------------------ */

describe("costOf", () => {
  test("prices plain input and output at the published per-1M rates", () => {
    // claude-sonnet-5 is $2/$10 per 1M.
    const { costUsd, known } = costOf({
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(known).toBe(true);
    expect(costUsd).toBeCloseTo(12, 10);
  });

  test("cache reads bill at a tenth of the input rate", () => {
    const { costUsd } = costOf({ model: "claude-sonnet-5", cacheReadTokens: 1_000_000 });
    expect(costUsd).toBeCloseTo(2 * CACHE_READ_MULTIPLIER, 10); // $0.20
  });

  test("cache writes bill at 1.25x the input rate", () => {
    const { costUsd } = costOf({ model: "claude-sonnet-5", cacheWriteTokens: 1_000_000 });
    expect(costUsd).toBeCloseTo(2 * CACHE_WRITE_MULTIPLIER, 10); // $2.50
  });

  test("the four buckets are summed at three different rates", () => {
    // The whole point of keeping them apart: folding cache tokens into
    // inputTokens would overcharge the read 10x and undercharge the write.
    const { costUsd } = costOf({
      model: "claude-opus-5", // $5 / $25
      inputTokens: 100_000,
      outputTokens: 10_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 200_000,
    });
    const expected =
      (100_000 * 5 + 10_000 * 25 + 500_000 * 5 * 0.1 + 200_000 * 5 * 1.25) / 1_000_000;
    expect(costUsd).toBeCloseTo(expected, 10);
    // $0.50 input + $0.25 output + $0.25 cache reads + $1.25 cache writes.
    expect(costUsd).toBeCloseTo(2.25, 10);
  });

  test("prices a Bedrock inference-profile id, not just a bare one", () => {
    const bedrock = costOf({ model: "us.anthropic.claude-opus-5", inputTokens: 1_000_000 });
    const canonical = costOf({ model: "claude-opus-5", inputTokens: 1_000_000 });
    expect(bedrock.costUsd).toBe(canonical.costUsd);
    expect(bedrock.model).toBe("claude-opus-5");
  });

  test("an unknown model costs 0 and says so, rather than guessing", () => {
    const result = costOf({
      model: "claude-brand-new-7",
      inputTokens: 5_000_000,
      outputTokens: 5_000_000,
    });
    expect(result.known).toBe(false);
    expect(result.costUsd).toBe(0);
  });

  test("missing, negative and non-finite token counts are treated as zero", () => {
    expect(costOf({ model: "claude-sonnet-5" }).costUsd).toBe(0);
    expect(
      costOf({ model: "claude-sonnet-5", inputTokens: -100, outputTokens: Number.NaN }).costUsd,
    ).toBe(0);
  });

  test("the fable/haiku ends of the table are priced apart, not flattened", () => {
    const cheap = costOf({ model: "claude-haiku-4-5", outputTokens: 1_000_000 }).costUsd;
    const dear = costOf({ model: "claude-fable-5", outputTokens: 1_000_000 }).costUsd;
    expect(cheap).toBeCloseTo(5, 10);
    expect(dear).toBeCloseTo(50, 10);
  });
});
