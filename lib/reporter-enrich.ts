/**
 * Turns raw discussion text (`DigestItem.discussion`, pulled by the source
 * fetchers for community items) into a distilled one-line "what people
 * actually think / how they're using it" sentiment signal (`DigestItem.insight`).
 *
 * Reuses the existing AI backend (lib/map-ai.ts) — local `claude` CLI, else
 * the Anthropic API — exactly like app/api/reporter/summarize/route.ts.
 *
 * `discussion` is transient and must never be persisted: this is the one place
 * that reads it, and it always clears it before returning, AI or not.
 */

import { aiEnabled, aiStructuredCall } from "@/lib/map-ai";
import type { DigestItem } from "@/lib/reporter-types";

/** Bound cost: only the most prominent unenriched items get sent to the AI. */
const MAX_ITEMS = 25;
/** Per-item cap on how many raw comments feed the prompt. */
const MAX_COMMENTS_PER_ITEM = 5;
/** Per-comment character clip so one long rant can't blow up the prompt. */
const COMMENT_CLIP = 400;
/** Items per aiStructuredCall — keeps each batch's prompt modest. */
const BATCH_SIZE = 12;
/** Per-batch timeout — mirrors the summarize route's pattern, kept shorter
 * since each batch is a much smaller ask. */
const ENRICH_TIMEOUT_MS = 60 * 1000;

type EnrichResult = { id: string; insight: string };

/**
 * Distill `discussion` into `insight` for the most prominent items that need
 * it, then clear `discussion` from every item before returning (it must never
 * be persisted). Fully resilient: any AI failure is caught and logged, never
 * thrown — the digest always comes back usable.
 */
export async function enrichDigest(items: DigestItem[]): Promise<DigestItem[]> {
  if (!aiEnabled()) {
    for (const it of items) delete it.discussion;
    return items;
  }

  const candidates = items
    .filter((it) => it.discussion && it.discussion.length > 0 && !it.insight)
    .sort((a, b) => b.sortTs - a.sortTs)
    .slice(0, MAX_ITEMS);

  if (candidates.length > 0) {
    const batches: DigestItem[][] = [];
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      batches.push(candidates.slice(i, i + BATCH_SIZE));
    }

    const outcomes = await Promise.allSettled(batches.map((batch) => enrichBatch(batch)));
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        console.error("reporter-enrich: batch failed", outcome.reason);
      }
    }
  }

  // Never persist raw comment text, enriched or not.
  for (const it of items) delete it.discussion;
  return items;
}

/** Ask the AI for a distilled insight for each item in one batch. */
async function enrichBatch(batch: DigestItem[]): Promise<void> {
  const threads = batch
    .map((it) => {
      const comments = (it.discussion ?? [])
        .slice(0, MAX_COMMENTS_PER_ITEM)
        .map((c) => c.trim().slice(0, COMMENT_CLIP))
        .filter(Boolean);
      const body = comments.length > 0 ? comments.map((c) => `- ${c}`).join("\n") : "- (no comments)";
      return `id: ${it.id}\ntitle: ${it.title}\ncomments:\n${body}`;
    })
    .join("\n\n");

  const system = `You distill raw discussion comments (from Hacker News / Reddit threads about Claude Code, AI agents, and developer tools) into a single short sentence of real sentiment: what people actually think, and/or how they're using the thing being discussed. Plain English, concrete, no hedging or filler.`;

  const user = `Here are ${batch.length} discussion threads, each with an id, title, and raw comments:

${threads}

For each id, write one plain-English sentence of at most 18 words capturing what commenters think and/or how they use it (e.g. "Users love the speed but hit rate-limit errors on large repos"). If a thread is just noise with no real signal, use an empty string for that id.`;

  let result: { results?: EnrichResult[] };
  try {
    result = await aiStructuredCall<{ results: EnrichResult[] }>({
      system,
      user,
      toolName: "submit_insights",
      toolDescription: "Submit the distilled community-sentiment insight for each discussion thread.",
      timeoutMs: ENRICH_TIMEOUT_MS,
      schema: {
        type: "object",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "The thread's id, copied exactly." },
                insight: {
                  type: "string",
                  description: "A ≤18-word plain-English sentence, or empty string if there's no real signal.",
                },
              },
              required: ["id", "insight"],
              additionalProperties: false,
            },
          },
        },
        required: ["results"],
        additionalProperties: false,
      },
    });
  } catch (err) {
    console.error("reporter-enrich: aiStructuredCall failed", err);
    return;
  }

  const byId = new Map(batch.map((it) => [it.id, it]));
  for (const r of result.results ?? []) {
    const item = byId.get(r?.id);
    if (item && typeof r.insight === "string" && r.insight.trim()) {
      item.insight = r.insight.trim();
    }
  }
}
