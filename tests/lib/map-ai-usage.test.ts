import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The first test in this repo that actually executes one of map-ai's six
 * backend branches. tests/lib/map-ai.test.ts mocks node:fs only, so every test
 * there stops at backend selection and none of the parsing below it had ever
 * run under test.
 *
 * Two mocks make the CLI branch reachable with no real process:
 *   - node:fs  existsSync -> true, so findCli() finds a binary;
 *   - node:child_process  execFile -> hands back whatever envelope a test wants.
 */
const { execFileImpl } = vi.hoisted(() => ({ execFileImpl: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: (...args: unknown[]) => execFileImpl(...args) };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: () => true, mkdirSync: () => undefined };
});

import { AI_LABELS, getRecentUsage, resetUsage } from "../../lib/ai-usage";
import { aiChatCall, aiStructuredCall } from "../../lib/map-ai";

/* ------------------------------------------------------------------ */
/* The real CLI envelope                                               */
/* ------------------------------------------------------------------ */

/**
 * Measured against claude 2.1.261. The five fields map-ai already parsed
 * (`type`/`subtype`/`is_error`/`result`/`structured_output`) plus everything it
 * was throwing away — the accounting this whole module exists to capture.
 */
const CLI_ENVELOPE = {
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 8412,
  duration_api_ms: 8102,
  ttft_ms: 941,
  num_turns: 1,
  result: '{"summary":"drafted"}',
  session_id: "0f2c4c2e-1f2b-4a44-9b91-7d3a0a5e6c11",
  total_cost_usd: 0.0413,
  stop_reason: "end_turn",
  usage: {
    input_tokens: 12,
    cache_creation_input_tokens: 4096,
    cache_read_input_tokens: 20480,
    output_tokens: 613,
    output_tokens_details: { thinking_tokens: 0 },
    service_tier: "standard",
  },
  modelUsage: {
    "claude-sonnet-5": {
      inputTokens: 12,
      outputTokens: 613,
      cacheReadInputTokens: 20480,
      cacheCreationInputTokens: 4096,
      costUSD: 0.0413,
      contextWindow: 200000,
      thinkingTokens: 0,
      canonicalModel: "claude-sonnet-5",
      provider: "anthropic",
      costBasis: "list",
    },
  },
  structured_output: { summary: "drafted" },
};

/** Queue one stdout per expected CLI invocation, consumed in order. */
function queueEnvelopes(...envelopes: unknown[]): void {
  let i = 0;
  execFileImpl.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) => {
      const next = envelopes[Math.min(i, envelopes.length - 1)];
      i += 1;
      cb(null, typeof next === "string" ? next : JSON.stringify(next), "");
    },
  );
}

const ENV_KEYS = [
  "DASHBOARD_AI_BACKEND",
  "DASHBOARD_AI_MODEL",
  "DASHBOARD_AI_CHAT_MODEL",
  "ANTHROPIC_API_KEY",
  "DASHBOARD_AI_BEDROCK_REGION",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "USAGE_STORE",
] as const;
let original: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as typeof original;
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.DASHBOARD_AI_BACKEND = "cli";
  process.env.USAGE_STORE = "off"; // never touch the repo's real usage log
  execFileImpl.mockReset();
  resetUsage();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  resetUsage();
});

const STRUCTURED = {
  system: "You draft process maps.",
  user: "Draft one.",
  toolName: "draft",
  toolDescription: "a draft",
  schema: { type: "object" as const },
};

/* ------------------------------------------------------------------ */
/* The CLI branch, structured                                          */
/* ------------------------------------------------------------------ */

describe("cli/structured usage extraction", () => {
  test("still returns the structured output unchanged", async () => {
    queueEnvelopes(CLI_ENVELOPE);
    const out = await aiStructuredCall<{ summary: string }>({ ...STRUCTURED, label: AI_LABELS.loopEdit });
    expect(out).toEqual({ summary: "drafted" });
  });

  test("records one usage record with every token bucket off the envelope", async () => {
    queueEnvelopes(CLI_ENVELOPE);
    await aiStructuredCall({ ...STRUCTURED, label: AI_LABELS.loopEdit });

    const [r, ...rest] = getRecentUsage();
    expect(rest).toHaveLength(0);
    expect(r.backend).toBe("cli");
    expect(r.kind).toBe("structured");
    expect(r.label).toBe(AI_LABELS.loopEdit);
    expect(r.ok).toBe(true);
    expect(r.errorKind).toBeUndefined();

    expect(r.inputTokens).toBe(12);
    expect(r.outputTokens).toBe(613);
    expect(r.cacheReadTokens).toBe(20480);
    expect(r.cacheWriteTokens).toBe(4096);
    // 12 + 20480 + 4096 — the actual prompt size, not the uncached remainder.
    expect(r.totalInputTokens).toBe(24588);
  });

  test("takes the model id from modelUsage, not the 'sonnet' alias we asked for", async () => {
    queueEnvelopes(CLI_ENVELOPE);
    await aiStructuredCall(STRUCTURED);
    expect(getRecentUsage()[0].model).toBe("claude-sonnet-5");
  });

  test("carries the CLI's own dollar figure, as a list price", async () => {
    queueEnvelopes(CLI_ENVELOPE);
    await aiStructuredCall(STRUCTURED);
    const r = getRecentUsage()[0];
    expect(r.costUsd).toBe(0.0413);
    // Not spend: a CLI call runs on the flat-fee subscription.
    expect(r.costBasis).toBe("list");
  });

  test("times the call", async () => {
    queueEnvelopes(CLI_ENVELOPE);
    await aiStructuredCall(STRUCTURED);
    expect(getRecentUsage()[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test("an unlabelled call is attributed to 'unknown', not dropped", async () => {
    queueEnvelopes(CLI_ENVELOPE);
    await aiStructuredCall(STRUCTURED);
    expect(getRecentUsage()[0].label).toBe("unknown");
  });

  test("falls back to the flat usage block when an older CLI emits no modelUsage", async () => {
    const older: Partial<typeof CLI_ENVELOPE> = { ...CLI_ENVELOPE };
    delete older.modelUsage;
    queueEnvelopes(older);
    await aiStructuredCall({ ...STRUCTURED, label: AI_LABELS.loopEdit });

    const r = getRecentUsage()[0];
    expect(r.inputTokens).toBe(12);
    expect(r.cacheReadTokens).toBe(20480);
    expect(r.totalInputTokens).toBe(24588);
    // No modelUsage means no resolved id, so the alias we sent is normalized.
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.costUsd).toBe(0.0413); // total_cost_usd still present
  });

  test("records tokens even when the envelope reports a failure", async () => {
    // A failed turn still burned the prompt, and the CLI reports both in the
    // same envelope. Counting only successes is how a retry storm hides.
    queueEnvelopes({ ...CLI_ENVELOPE, is_error: true, subtype: "error_during_execution" });
    await expect(aiStructuredCall({ ...STRUCTURED, label: AI_LABELS.loopEdit })).rejects.toThrow();

    const r = getRecentUsage()[0];
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("http-502");
    expect(r.totalInputTokens).toBe(24588);
    expect(r.label).toBe(AI_LABELS.loopEdit);
  });

  test("a spawn failure is still recorded, with no tokens to report", async () => {
    execFileImpl.mockImplementation(
      (_f: string, _a: string[], _o: unknown, cb: (e: unknown, o: string, s: string) => void) =>
        cb(Object.assign(new Error("ENOENT"), { code: "ENOENT" }), "", ""),
    );
    await expect(aiStructuredCall({ ...STRUCTURED, label: AI_LABELS.loopEdit })).rejects.toThrow();

    const r = getRecentUsage()[0];
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("http-502");
    expect(r.totalInputTokens).toBe(0);
    expect(r.model).toBe("claude-sonnet-5"); // the alias we were about to send
  });

  test("a parse retry is two records, not one — both attempts' tokens survive", async () => {
    const unparseable = { ...CLI_ENVELOPE, structured_output: undefined, result: "no json here" };
    queueEnvelopes(unparseable, CLI_ENVELOPE);

    await aiStructuredCall({ ...STRUCTURED, label: AI_LABELS.loopEdit });
    expect(execFileImpl).toHaveBeenCalledTimes(2);

    const records = getRecentUsage(); // newest first
    expect(records).toHaveLength(2);
    expect(records[0].ok).toBe(true);
    expect(records[1].ok).toBe(false);
    expect(records[1].errorKind).toBe("parse");
    // Both attempts really ran, so both prompts are counted.
    expect(records[0].totalInputTokens).toBe(24588);
    expect(records[1].totalInputTokens).toBe(24588);
  });
});

/* ------------------------------------------------------------------ */
/* The CLI branch, chat                                                */
/* ------------------------------------------------------------------ */

describe("cli/chat usage extraction", () => {
  const CHAT = {
    system: "You are the help assistant.",
    messages: [{ role: "user" as const, content: "How does the loop work?" }],
  };

  test("returns the reply and records it as a chat call", async () => {
    queueEnvelopes({ ...CLI_ENVELOPE, result: "It runs on a schedule." });
    const reply = await aiChatCall({ ...CHAT, label: "help-assistant" });
    expect(reply).toBe("It runs on a schedule.");

    const r = getRecentUsage()[0];
    expect(r.kind).toBe("chat");
    expect(r.backend).toBe("cli");
    expect(r.label).toBe("help-assistant");
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.totalInputTokens).toBe(24588);
    expect(r.outputTokens).toBe(613);
  });

  test("an empty reply is recorded as a failure, with its tokens", async () => {
    queueEnvelopes({ ...CLI_ENVELOPE, result: "   " });
    await expect(aiChatCall({ ...CHAT, label: "help-assistant" })).rejects.toThrow();
    const r = getRecentUsage()[0];
    expect(r.ok).toBe(false);
    expect(r.totalInputTokens).toBe(24588);
  });
});

/* ------------------------------------------------------------------ */
/* No backend at all                                                   */
/* ------------------------------------------------------------------ */

describe("when AI is switched off", () => {
  test("records nothing — a call that never happened has no usage", async () => {
    process.env.DASHBOARD_AI_BACKEND = "api"; // and no ANTHROPIC_API_KEY -> disabled
    await expect(aiStructuredCall(STRUCTURED)).rejects.toThrow();
    expect(getRecentUsage()).toHaveLength(0);
  });
});
