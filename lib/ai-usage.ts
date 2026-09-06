/**
 * Token and cost accounting for every AI call the dashboard makes.
 *
 * ## Why
 *
 * lib/map-ai.ts has six backend branches and, until this file existed, all six
 * threw the usage numbers away. The CLI envelope carries a full `modelUsage`
 * block with a dollar figure in it; the Anthropic and Bedrock responses both
 * carry a `usage` object; every one of them was parsed for its answer and then
 * dropped on the floor. So the dashboard could tell you a draft was produced
 * and not that it cost 40k tokens to produce, which is exactly the number that
 * matters once this thing runs anywhere but a laptop.
 *
 * ## What a record means
 *
 * Every record is *list-price equivalent*, never spend — see lib/ai-pricing.ts
 * for why the two are not the same thing here. `costBasis` is a literal `"list"`
 * on the type so a consumer cannot quietly start treating it as a bill.
 *
 * ## Where records go
 *
 * Two places, deliberately:
 *
 *   1. a bounded in-memory ring (RING_CAPACITY entries) — what /api/usage reads,
 *      so the live view costs nothing and cannot grow;
 *   2. an append-only JSONL file via lib/usage-store.ts — what survives a
 *      restart. That write is fire-and-forget: a usage record is telemetry, and
 *      telemetry must never be the reason a draft fails.
 *
 * Recording is total: `recordUsage` swallows everything. A throw out of this
 * module would turn an accounting bug into a broken AI call, which is precisely
 * backwards.
 */

import { costOf, normalizeModelId } from "./ai-pricing";
import { appendUsage } from "./usage-store";

/** One AI call, as accounted for. */
export type AiUsageRecord = {
  /** ISO timestamp of when the call finished. */
  ts: string;
  /** Feature attribution, e.g. "pr-chat", "tool-fit". "unknown" when unset. */
  label: string;
  backend: "cli" | "api" | "bedrock";
  model: string;
  kind: "structured" | "chat";
  /** UNCACHED input only — what the API calls `input_tokens`. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /**
   * The real prompt size: inputTokens + cacheReadTokens + cacheWriteTokens.
   *
   * This is the field to read for "how big was the prompt". `input_tokens` from
   * the API is the uncached REMAINDER, so once prompt caching is switched on it
   * collapses toward zero while the prompt itself stays the same size. Anything
   * that charts `inputTokens` alone would show usage falling off a cliff and be
   * wrong. Computed in exactly one place (`makeUsageRecord`) so it cannot drift.
   */
  totalInputTokens: number;
  /** USD at published list rates. Never claimed to be actual spend. */
  costUsd: number;
  costBasis: "list";
  durationMs: number;
  ok: boolean;
  /** Short machine-ish tag for the failure, e.g. "http-504". Absent when ok. */
  errorKind?: string;
};

/**
 * How many records the in-process ring holds. 500 is roughly a day of the
 * owner's use at current volumes and costs a few hundred KB; the JSONL file is
 * the long tail.
 */
export const RING_CAPACITY = 500;

let ring: AiUsageRecord[] = [];

/* ------------------------------------------------------------------ */
/* Building a record                                                   */
/* ------------------------------------------------------------------ */

/** The four token buckets, as any backend might report them. */
export type RawTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type MakeUsageInput = {
  label?: string;
  backend: AiUsageRecord["backend"];
  kind: AiUsageRecord["kind"];
  model?: string;
  tokens?: RawTokenUsage;
  /**
   * Cost the backend reported itself (the CLI envelope's `total_cost_usd` /
   * `modelUsage[].costUSD`). Preferred over the price table when present — it
   * is the same list-price arithmetic done by something that knows exactly
   * which model answered. Still `costBasis: "list"`: the owner's subscription
   * means no such dollar actually changed hands.
   */
  costUsd?: number;
  durationMs: number;
  ok: boolean;
  errorKind?: string;
  /** Overridable so tests can pin a timestamp. */
  ts?: string;
};

function num(n: number | undefined): number {
  return Number.isFinite(n) && (n as number) > 0 ? (n as number) : 0;
}

/**
 * Assemble a record, filling in the two things a caller should never compute
 * for itself: `totalInputTokens` and, when the backend didn't say, the cost.
 */
export function makeUsageRecord(input: MakeUsageInput): AiUsageRecord {
  const inputTokens = num(input.tokens?.inputTokens);
  const outputTokens = num(input.tokens?.outputTokens);
  const cacheReadTokens = num(input.tokens?.cacheReadTokens);
  const cacheWriteTokens = num(input.tokens?.cacheWriteTokens);

  const model = normalizeModelId(input.model ?? "") || "unknown";

  // A backend-reported figure wins; otherwise price it ourselves. An unpriced
  // model yields 0 rather than a guess (see costOf's `known` flag).
  const costUsd = Number.isFinite(input.costUsd)
    ? (input.costUsd as number)
    : costOf({ model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }).costUsd;

  return {
    ts: input.ts ?? new Date().toISOString(),
    label: input.label?.trim() || "unknown",
    backend: input.backend,
    model,
    kind: input.kind,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalInputTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
    costUsd,
    costBasis: "list",
    durationMs: num(input.durationMs),
    ok: input.ok,
    ...(input.ok ? {} : { errorKind: input.errorKind || "unknown" }),
  };
}

/* ------------------------------------------------------------------ */
/* The sink                                                            */
/* ------------------------------------------------------------------ */

/**
 * Record one call. Never throws — a failure to account for a call must not
 * become a failure of the call. Both the ring push and the durable append are
 * inside the guard, and the append is not awaited.
 */
export function recordUsage(record: AiUsageRecord): void {
  try {
    ring.push(record);
    if (ring.length > RING_CAPACITY) ring = ring.slice(ring.length - RING_CAPACITY);
    // Fire-and-forget: the request path never waits on telemetry, and a
    // rejected promise here is already handled inside appendUsage.
    void appendUsage(record);
  } catch (err) {
    console.warn("[ai-usage] failed to record usage", err);
  }
}

/** Convenience: build and record in one step. Returns what it recorded. */
export function recordUsageFrom(input: MakeUsageInput): AiUsageRecord {
  const record = makeUsageRecord(input);
  recordUsage(record);
  return record;
}

/** Most recent first — the newest `limit` records (default: everything held). */
export function getRecentUsage(limit = RING_CAPACITY): AiUsageRecord[] {
  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : RING_CAPACITY;
  return ring.slice(Math.max(0, ring.length - n)).reverse();
}

/** Drop everything held in this process. Tests only. */
export function resetUsage(): void {
  ring = [];
}

/* ------------------------------------------------------------------ */
/* Summarising                                                         */
/* ------------------------------------------------------------------ */

export type UsageTotals = {
  calls: number;
  ok: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** inputTokens + cacheReadTokens + cacheWriteTokens — the real prompt size. */
  totalInputTokens: number;
  /** totalInputTokens + outputTokens. */
  totalTokens: number;
  costUsd: number;
  durationMs: number;
};

export type UsageSummary = {
  /** Restated on the summary so a consumer reading only this can't miss it. */
  costBasis: "list";
  /** Oldest and newest timestamps in the set, or null when it's empty. */
  since: string | null;
  until: string | null;
  totals: UsageTotals;
  byLabel: (UsageTotals & { label: string })[];
  byModel: (UsageTotals & { model: string })[];
  byBackend: (UsageTotals & { backend: string })[];
};

function emptyTotals(): UsageTotals {
  return {
    calls: 0,
    ok: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalInputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    durationMs: 0,
  };
}

function addTo(totals: UsageTotals, r: AiUsageRecord): void {
  totals.calls += 1;
  if (r.ok) totals.ok += 1;
  else totals.failed += 1;
  totals.inputTokens += r.inputTokens;
  totals.outputTokens += r.outputTokens;
  totals.cacheReadTokens += r.cacheReadTokens;
  totals.cacheWriteTokens += r.cacheWriteTokens;
  totals.totalInputTokens += r.totalInputTokens;
  totals.totalTokens += r.totalInputTokens + r.outputTokens;
  totals.costUsd += r.costUsd;
  totals.durationMs += r.durationMs;
}

/**
 * Group into a `{key: totals}` map, then emit it most-expensive-first — the
 * order the question "where is this going?" actually wants.
 */
function group<K extends string>(
  records: AiUsageRecord[],
  keyName: K,
  keyOf: (r: AiUsageRecord) => string,
): (UsageTotals & Record<K, string>)[] {
  const buckets = new Map<string, UsageTotals>();
  for (const r of records) {
    const key = keyOf(r);
    let totals = buckets.get(key);
    if (!totals) {
      totals = emptyTotals();
      buckets.set(key, totals);
    }
    addTo(totals, r);
  }
  return [...buckets.entries()]
    .map(([key, totals]) => ({ ...totals, [keyName]: key }) as UsageTotals & Record<K, string>)
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
}

/** Totals plus per-label, per-model and per-backend breakdowns. */
export function summarizeUsage(records: AiUsageRecord[]): UsageSummary {
  const list = Array.isArray(records) ? records : [];
  const totals = emptyTotals();
  for (const r of list) addTo(totals, r);

  const timestamps = list.map((r) => r.ts).filter(Boolean).sort();

  return {
    costBasis: "list",
    since: timestamps[0] ?? null,
    until: timestamps[timestamps.length - 1] ?? null,
    totals,
    byLabel: group(list, "label", (r) => r.label),
    byModel: group(list, "model", (r) => r.model),
    byBackend: group(list, "backend", (r) => r.backend),
  };
}
