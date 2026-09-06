/**
 * List prices for the Claude models this dashboard calls, and the arithmetic
 * that turns a token count into dollars.
 *
 * ## What this is NOT
 *
 * It is not a bill. Three of the four ways this app reaches a model do not
 * produce a per-call invoice at all:
 *
 *   - the `cli` backend runs on the owner's Claude Max subscription, which is a
 *     flat monthly fee — a call there costs $0 marginal, no matter how many
 *     tokens it burns;
 *   - the `bedrock` backend bills through AWS, at AWS's rates, against whatever
 *     region/commitment the account has;
 *   - only the `api` backend is billed at roughly these numbers, and even then
 *     a discount, a batch, or a long-context surcharge moves it.
 *
 * So everything computed here is a *list-price equivalent*: "what this call
 * would have cost at published first-party rates". That is the honest thing to
 * show on a dashboard whose whole point is to make LLM usage legible, and it is
 * why every record carries `costBasis: "list"` rather than pretending to be
 * spend. See lib/ai-usage.ts.
 *
 * ## Rates
 *
 * USD per 1,000,000 tokens, first-party published pricing. When a model is not
 * in the table the answer is `known: false` and a cost of 0 — a missing price
 * shows up as a gap the owner can see and fix, whereas guessing a neighbouring
 * model's rate produces a number that looks authoritative and is wrong.
 */

/** USD per 1M tokens for one model. */
export type ModelPrice = {
  /** Uncached input (the `input_tokens` the API reports). */
  input: number;
  /** Output / completion tokens. */
  output: number;
};

/**
 * Cache reads bill at a tenth of the input rate; writing a 5-minute cache entry
 * costs a 25% premium over plain input. This pass does not send `cache_control`
 * at all (deliberately out of scope) — the multipliers are here so that the
 * moment caching is switched on, the numbers are already right rather than
 * silently counting a cache read as full-price input.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

/** One million, spelled out once so the divisions below read as prices. */
const PER_TOKENS = 1_000_000;

/**
 * The price table. Keys are canonical first-party model ids — the same spelling
 * `DASHBOARD_AI_MODEL` takes and the same keys `BEDROCK_MODEL_IDS` in
 * lib/map-ai.ts is keyed by, so a model added there has an obvious place here.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
};

/**
 * Bare aliases the CLI accepts (`--model sonnet`) and that therefore turn up in
 * a usage record with no version attached. Mapped to whatever this dashboard
 * would actually have been given for that alias, which matches map-ai.ts's
 * defaults (`claude-sonnet-5`).
 */
const ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5",
};

/**
 * Prefixes a Bedrock model id can carry. Cross-region inference profiles put a
 * geography in front (`us.`, `eu.`, `global.`…), and the Bedrock id itself
 * carries the provider (`anthropic.`). Both are routing detail, not identity:
 * `us.anthropic.claude-sonnet-5` is billed as claude-sonnet-5.
 */
const PREFIX_RE = /^(?:global|us|eu|jp|au|apac|us-gov)\./;
const PROVIDER_RE = /^anthropic\./;

/**
 * Trailing version junk on an ARN-style id:
 *   -20250929-v1:0   date + version
 *   -v1:0 / -v1      version alone
 *   :0               a bare ARN version
 * Stripped so `global.anthropic.claude-sonnet-4-6-20250929-v1:0` and
 * `claude-sonnet-4-6` price identically.
 */
const VERSION_SUFFIX_RE = /(?:-\d{8})?(?:-v\d+)?(?::\d+)?$/;

/**
 * Reduce any spelling of a model id to the canonical first-party id used as a
 * key in MODEL_PRICES. Returns the normalized string whether or not it is
 * priced, so callers can report the id they actually failed to price.
 */
export function normalizeModelId(model: string): string {
  let id = (model ?? "").trim().toLowerCase();
  if (!id) return "";

  // Inference-profile prefix, then provider prefix. Order matters:
  // "us.anthropic.claude-sonnet-5" needs both stripped, outermost first.
  id = id.replace(PREFIX_RE, "");
  id = id.replace(PROVIDER_RE, "");

  if (ALIASES[id]) return ALIASES[id];

  // Only strip a version suffix when something is left over that still looks
  // like a model id — otherwise ":0" on its own would eat the whole string.
  const stripped = id.replace(VERSION_SUFFIX_RE, "");
  if (stripped) id = stripped;

  return ALIASES[id] ?? id;
}

export type PriceLookup = {
  /** The canonical id the lookup resolved to (useful for grouping). */
  model: string;
  /** false when the model isn't in the table — cost is then 0, not a guess. */
  known: boolean;
  price: ModelPrice;
};

/** Look up one model's rates, normalizing whatever spelling came in. */
export function priceFor(model: string): PriceLookup {
  const id = normalizeModelId(model);
  const price = MODEL_PRICES[id];
  if (!price) return { model: id, known: false, price: { input: 0, output: 0 } };
  return { model: id, known: true, price };
}

export type CostInput = {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type CostResult = {
  /** USD at published list rates. 0 when the model is unpriced. */
  costUsd: number;
  /** false when the model isn't in the table, so a 0 can be told from a real 0. */
  known: boolean;
  /** The canonical id used for the lookup. */
  model: string;
};

/** Non-finite / negative token counts are treated as 0 rather than poisoning a sum. */
function tokens(n: number | undefined): number {
  return Number.isFinite(n) && (n as number) > 0 ? (n as number) : 0;
}

/**
 * Cost of one call at list price.
 *
 * The four token buckets bill at three different rates: output at the output
 * rate, plain input at the input rate, cache reads at a tenth of input, cache
 * writes at 1.25x input. Adding cache tokens into `inputTokens` and multiplying
 * once would over-charge reads by 10x and under-charge writes.
 */
export function costOf(input: CostInput): CostResult {
  const { model, known, price } = priceFor(input.model);
  if (!known) return { costUsd: 0, known: false, model };

  const usd =
    (tokens(input.inputTokens) * price.input +
      tokens(input.outputTokens) * price.output +
      tokens(input.cacheReadTokens) * price.input * CACHE_READ_MULTIPLIER +
      tokens(input.cacheWriteTokens) * price.input * CACHE_WRITE_MULTIPLIER) /
    PER_TOKENS;

  return { costUsd: usd, known: true, model };
}
