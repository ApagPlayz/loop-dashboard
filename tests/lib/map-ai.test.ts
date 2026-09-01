import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// aiBackend()/findCli() probe the filesystem for a local `claude` binary.
// Mock node:fs so that probe deterministically finds nothing, isolating the
// backend-selection logic to pure env-var behaviour with no real I/O.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: () => false };
});

import {
  AiError,
  aiBackend,
  bedrockModel,
  httpStatusError,
  parseLoose,
  stopReasonError,
} from "../../lib/map-ai";

/* ------------------------------------------------------------------ */
/* parseLoose                                                          */
/* ------------------------------------------------------------------ */

describe("parseLoose", () => {
  test("strips a ```json fence and parses the object inside", () => {
    const text = '```json\n{"a": 1, "b": "two"}\n```';
    expect(parseLoose(text)).toEqual({ a: 1, b: "two" });
  });

  test("strips a bare ``` fence with no language tag", () => {
    const text = '```\n{"ok": true}\n```';
    expect(parseLoose(text)).toEqual({ ok: true });
  });

  test("extracts the JSON object from surrounding prose", () => {
    const text = 'Sure, here you go:\n{"result": "done"}\nLet me know if you need more.';
    expect(parseLoose(text)).toEqual({ result: "done" });
  });

  test("handles an object containing nested braces", () => {
    const text = 'prefix { "a": 1, "nested": { "c": 2 } } suffix';
    expect(parseLoose(text)).toEqual({ a: 1, nested: { c: 2 } });
  });

  test("throws when there is no JSON object at all", () => {
    expect(() => parseLoose("just plain prose, no braces here")).toThrow("no JSON object found");
  });

  test("throws when the braces don't contain valid JSON", () => {
    expect(() => parseLoose("{not valid json,,, }")).toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* AiError                                                             */
/* ------------------------------------------------------------------ */

describe("AiError", () => {
  test("defaults httpStatus to 502 and carries the message", () => {
    const err = new AiError("something went wrong");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toBe("something went wrong");
    expect(err.httpStatus).toBe(502);
  });

  test("accepts a custom httpStatus", () => {
    const err = new AiError("rate limited", 429);
    expect(err.httpStatus).toBe(429);
  });
});

/* ------------------------------------------------------------------ */
/* httpStatusError                                                     */
/* ------------------------------------------------------------------ */

describe("httpStatusError", () => {
  test("401 and 403 both map to a credentials-rejected message with httpStatus 503", () => {
    const unauthorized = httpStatusError(401, "claude-sonnet-5");
    const forbidden = httpStatusError(403, "claude-sonnet-5");
    for (const err of [unauthorized, forbidden]) {
      expect(err.httpStatus).toBe(503);
      expect(err.message).toContain("credentials");
    }
  });

  test("429 maps to a rate-limit message with the default httpStatus (502)", () => {
    const err = httpStatusError(429, "claude-sonnet-5");
    expect(err.message).toMatch(/rate-limited/i);
    expect(err.httpStatus).toBe(502);
  });

  test("404 maps to a model-not-found message naming the model, httpStatus 503", () => {
    const err = httpStatusError(404, "claude-made-up-5");
    expect(err.message).toContain("claude-made-up-5");
    expect(err.message).toContain("DASHBOARD_AI_MODEL");
    expect(err.httpStatus).toBe(503);
  });

  test("an unrecognized status falls back to a generic message, httpStatus 502", () => {
    const err = httpStatusError(500, "claude-sonnet-5");
    expect(err.httpStatus).toBe(502);
    expect(err.message).toMatch(/error/i);
  });
});

/* ------------------------------------------------------------------ */
/* stopReasonError                                                     */
/* ------------------------------------------------------------------ */

describe("stopReasonError", () => {
  test("max_tokens maps to a 422 'too large' error", () => {
    const err = stopReasonError("max_tokens");
    expect(err).toBeInstanceOf(AiError);
    expect(err?.httpStatus).toBe(422);
    expect(err?.message).toMatch(/too large/i);
  });

  test("refusal maps to a 422 'declined' error", () => {
    const err = stopReasonError("refusal");
    expect(err).toBeInstanceOf(AiError);
    expect(err?.httpStatus).toBe(422);
    expect(err?.message).toMatch(/declined/i);
  });

  test("any other stop reason (including null/undefined) returns null", () => {
    expect(stopReasonError("end_turn")).toBeNull();
    expect(stopReasonError(null)).toBeNull();
    expect(stopReasonError(undefined)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* bedrockModel — the BEDROCK_MODEL_IDS lookup table                   */
/* ------------------------------------------------------------------ */

describe("bedrockModel", () => {
  const BEDROCK_ENV_KEYS = [
    "DASHBOARD_AI_MODEL",
    "DASHBOARD_AI_BEDROCK_MODEL",
    "DASHBOARD_AI_BEDROCK_API",
  ] as const;
  let original: Record<(typeof BEDROCK_ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    original = Object.fromEntries(BEDROCK_ENV_KEYS.map((k) => [k, process.env[k]])) as typeof original;
    for (const k of BEDROCK_ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of BEDROCK_ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  test("DASHBOARD_AI_BEDROCK_MODEL override always wins, verbatim", () => {
    process.env.DASHBOARD_AI_MODEL = "claude-sonnet-5";
    process.env.DASHBOARD_AI_BEDROCK_MODEL = "some.custom.override-id";
    expect(bedrockModel()).toBe("some.custom.override-id");
  });

  test("defaults to claude-sonnet-5 on the mantle API when nothing is configured", () => {
    expect(bedrockModel()).toBe("anthropic.claude-sonnet-5");
  });

  test("uses the mantle id by default for a model that also has an invoke id", () => {
    process.env.DASHBOARD_AI_MODEL = "claude-sonnet-4-5";
    expect(bedrockModel()).toBe("anthropic.claude-sonnet-4-5");
  });

  test("DASHBOARD_AI_BEDROCK_API=invoke selects the inference-profile id", () => {
    process.env.DASHBOARD_AI_MODEL = "claude-sonnet-4-5";
    process.env.DASHBOARD_AI_BEDROCK_API = "invoke";
    expect(bedrockModel()).toBe("global.anthropic.claude-sonnet-4-5-20250929-v1:0");
  });

  test("invoke API throws for a model with no invoke entry in the table", () => {
    process.env.DASHBOARD_AI_MODEL = "claude-sonnet-5"; // mantle-only in BEDROCK_MODEL_IDS
    process.env.DASHBOARD_AI_BEDROCK_API = "invoke";
    expect(() => bedrockModel()).toThrow(AiError);
    try {
      bedrockModel();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).httpStatus).toBe(503);
    }
  });

  test("an already Bedrock-shaped DASHBOARD_AI_MODEL passes through untranslated", () => {
    process.env.DASHBOARD_AI_MODEL = "anthropic.some-hand-picked-id";
    expect(bedrockModel()).toBe("anthropic.some-hand-picked-id");
  });

  test("an unknown model with no table entry and no override throws AiError(503)", () => {
    process.env.DASHBOARD_AI_MODEL = "claude-does-not-exist";
    expect(() => bedrockModel()).toThrow(AiError);
    try {
      bedrockModel();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).httpStatus).toBe(503);
    }
  });
});

/* ------------------------------------------------------------------ */
/* aiBackend — pure function of env vars once the CLI probe is mocked  */
/* out (existsSync -> false, so findCli() always returns null).        */
/* ------------------------------------------------------------------ */

describe("aiBackend", () => {
  const BACKEND_ENV_KEYS = [
    "DASHBOARD_AI_BACKEND",
    "ANTHROPIC_API_KEY",
    "DASHBOARD_AI_BEDROCK_REGION",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
  ] as const;
  let original: Record<(typeof BACKEND_ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    original = Object.fromEntries(BACKEND_ENV_KEYS.map((k) => [k, process.env[k]])) as typeof original;
    for (const k of BACKEND_ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of BACKEND_ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  test('DASHBOARD_AI_BACKEND="cli" is disabled when the CLI binary isn\'t found', () => {
    process.env.DASHBOARD_AI_BACKEND = "cli";
    expect(aiBackend()).toBe("disabled");
  });

  test('DASHBOARD_AI_BACKEND="api" depends only on ANTHROPIC_API_KEY being set', () => {
    process.env.DASHBOARD_AI_BACKEND = "api";
    expect(aiBackend()).toBe("disabled");
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(aiBackend()).toBe("api");
  });

  test('DASHBOARD_AI_BACKEND="bedrock" depends only on a region being configured', () => {
    process.env.DASHBOARD_AI_BACKEND = "bedrock";
    expect(aiBackend()).toBe("disabled");
    process.env.DASHBOARD_AI_BEDROCK_REGION = "us-east-1";
    expect(aiBackend()).toBe("bedrock");
  });

  test('auto: disabled when nothing at all is configured', () => {
    process.env.DASHBOARD_AI_BACKEND = "auto";
    expect(aiBackend()).toBe("disabled");
  });

  test("auto: an Anthropic API key alone selects api", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(aiBackend()).toBe("api");
  });

  test("auto: an explicit DASHBOARD_AI_BEDROCK_REGION wins even when an API key is also present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DASHBOARD_AI_BEDROCK_REGION = "us-east-1";
    expect(aiBackend()).toBe("bedrock");
  });

  test("auto: a bare AWS_REGION (weak signal) only wins when there's no API key to prefer", () => {
    process.env.AWS_REGION = "us-east-1";
    expect(aiBackend()).toBe("bedrock");

    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(aiBackend()).toBe("api");
  });
});
