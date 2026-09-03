/**
 * Near-duplicate detection for the Ideas queue — the product surface for the
 * dedup pipeline in this directory.
 *
 * ## The problem this exists to solve
 *
 * The Scout files proposals as GitHub issues and never checks whether it has
 * already proposed the same thing. The pilot repo's queue holds ~42 open
 * issues; the eval corpus contains pairs that are near-verbatim restatements of
 * each other. Nobody triages a queue that long by re-reading it, so duplicates
 * sit there. This module puts the score on the card.
 *
 * ## Where the scoring happens, and why it is HERE and not the Lambda
 *
 * `infra/lambda-dedup-infer/` is a deployed, working Function URL that embeds
 * arbitrary text with Titan and scores it against the S3 index. It is the right
 * tool for text that is NOT in the corpus — a proposal the Scout is about to
 * file, say. It is the wrong tool for this screen, for one decisive reason:
 *
 *   **Every idea on the Ideas screen is already in the index.** Its vector was
 *   computed when the index was built. Scoring the queue against itself is
 *   therefore a lookup and a dot product — no embedding call, no Bedrock spend,
 *   no model download, no credentials beyond the S3 read that
 *   `artifact-store.ts` already knows how to do (and already falls back from).
 *
 * Routing that through the Lambda would mean signing SigV4 from the web tier,
 * holding runtime AWS credentials for it, and paying Bedrock to RE-EMBED text
 * whose vector is sitting in the very index the Lambda then loads — one billable
 * InvokeModel per idea per page view, to arrive at a number we already have. It
 * would be strictly slower, strictly more expensive, and strictly more things
 * that can break, in exchange for nothing.
 *
 * So: the Lambda stays as it is, and is still called by nothing in the product.
 * That is a real fact about the deployment and it should be stated as one.
 *
 * This also keeps the promise ARCHITECTURE.md §8.4 makes about `lib/dedup`:
 * embeddings go where they are needed and nowhere else. Nothing here loads an
 * ONNX model into the web tier (which the alpine container could not run
 * anyway), and nothing here creates new stored state — the vectors are an
 * artifact that already exists, and the issues are still the only source of
 * truth about the queue.
 *
 * ## How it degrades
 *
 * Every failure mode returns `null` and logs. There is no path out of
 * `findQueueDuplicates` that throws, and `loadIdeas` treats the result as
 * decoration: the Ideas screen renders identically with `duplicates: null`.
 *   - S3 unreachable / no credentials -> `artifact-store` falls back to the
 *     local file, and if that is missing too, `null`.
 *   - Both indexes unreadable -> `null`.
 *   - Load takes too long -> the race below gives up at `LOAD_TIMEOUT_MS` and
 *     returns `null` for this request, while the load continues in the
 *     background so the next request finds it cached.
 *   - Index is stale (an idea filed after the last build has no vector) -> that
 *     idea lands in `unindexed` and is reported, not silently scored as
 *     "no duplicates found". `indexBuiltAt` is returned so the UI can say when.
 *   - A project other than the one the corpus was extracted from -> `null`.
 */

import { cosineSim, indexToMap, type EmbeddingIndex } from "./embed";
import { loadEmbeddingIndex, loadJsonArtifact, type ArtifactSource } from "./artifact-store";

/* ------------------------------------------------------------------ */
/* Which repository the index describes                                */
/* ------------------------------------------------------------------ */

/**
 * The corpus — and therefore both embedding indexes — describes exactly ONE
 * repository: the pilot. `scripts/ml/extract-corpus.mjs` defaults to it and
 * `scripts/ml/generate-pairs.mjs` hard-codes it into the pair URLs.
 *
 * Nothing inside the index file records a repo, so the binding has to be
 * written down here — and enforced, because issue numbers are per-repo. Scoring
 * the supply-chain-optimizer queue against this index would confidently report
 * "#79 duplicates #27" about two issues in a repository the vectors have never
 * seen. Any other project simply gets no duplicate report.
 */
export const INDEX_REPO = { owner: "ApagPlayz", repo: "content-generation-platform" };

/* ------------------------------------------------------------------ */
/* Threshold                                                           */
/* ------------------------------------------------------------------ */

/** Which evaluated method an index corresponds to, in metrics/dedup-eval.json. */
const METHOD_FOR: Record<IndexBackend, "dense_titan" | "dense_local"> = {
  titan: "dense_titan",
  local: "dense_local",
};

/**
 * Cosine score at or above which a pair is called a duplicate.
 *
 * These are not invented numbers. Each is the `precision_first_operating_point`
 * for that method in `metrics/dedup-eval.json`, swept over the 150-pair
 * LLM-labelled gold set with positives = label "duplicate":
 *
 *     dense_titan   0.842   precision 0.909   recall 0.800
 *     dense_local   0.828   precision 0.950   recall 0.760
 *
 * Precision-first rather than best-F1 is the right criterion for this screen: a
 * false "this duplicates #27" costs the owner a click into an unrelated issue,
 * while a miss only leaves the status quo, which is a queue nobody triages. For
 * Titan the best-F1 sweep landed on the same 0.842, and two independent sweeps
 * agreeing is the reason to trust it rather than hand-tune.
 *
 * The eval's own caveats travel with the number and are not repaired by
 * repeating it here: the threshold was chosen on the data it is scored on, so
 * it is optimistically biased at this sample size, and corpus-level
 * (Horvitz-Thompson reweighted) recall is 0.583, not 0.800.
 *
 * The threshold is READ from the metrics artifact at runtime (see
 * `thresholdFor` below) so that re-running `scripts/ml/evaluate.mjs` actually
 * moves the product's threshold. These constants are the documented fallback
 * for when that artifact cannot be read at all.
 * `infra/lambda-dedup-infer/index.mjs` hard-codes the same 0.842 with no such
 * propagation — see docs/ml-dedup.md.
 */
const BUILTIN_THRESHOLD: Record<IndexBackend, number> = {
  titan: 0.842,
  local: 0.828,
};

/** Shape of the slice of metrics/dedup-eval.json this module reads. */
type DedupEvalMetrics = {
  results?: {
    duplicate?: Record<
      string,
      { precision_first_operating_point?: { threshold?: number } } | undefined
    >;
  };
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type IndexBackend = "titan" | "local";

/** One idea that scored at or above the threshold against another. */
export type DuplicateMatch = {
  /** Issue number of the matched idea. */
  number: number;
  /** Its title, taken from the live queue rather than the (older) corpus. */
  title: string;
  /**
   * GitHub URL of the matched idea, carried through from the queue rather than
   * assembled from a hard-coded owner/repo — the one place a constructed URL
   * could quietly point at the wrong repository.
   */
  htmlUrl: string;
  /** Cosine similarity, rounded to 4dp exactly as the Lambda rounds it. */
  score: number;
};

/**
 * What the Ideas screen needs to show a duplicate and to explain the number.
 *
 * `pairs` is keyed by issue number as a STRING because that is what it becomes
 * once `NextResponse.json` has been through it; typing it honestly here stops a
 * client from indexing with a number and getting `undefined` in the one
 * environment that matters.
 */
export type DuplicateReport = {
  /** Score at or above which a pair is reported. */
  threshold: number;
  /** Whether the threshold came from the eval artifact or the built-in fallback. */
  thresholdSource: "metrics" | "builtin";
  /** The evaluated method the threshold belongs to. */
  method: "dense_titan" | "dense_local";
  /** Model id that produced the vectors. */
  model: string;
  /** ISO build time of the index, so a stale index is visible rather than implied. */
  indexBuiltAt: string;
  /** Whether the index came from S3 or the local fallback copy. */
  indexSource: ArtifactSource;
  /** How many of the queue's ideas had a vector to score. */
  scored: number;
  /** Ideas with no vector — filed after the index was last built. */
  unindexed: number[];
  /** Issue number (as a string) -> its matches, best first. */
  pairs: Record<string, DuplicateMatch[]>;
};

/** The subset of an idea this module needs. Keeps `lib/queues.ts` free to change. */
export type ScorableIdea = { number: number; title: string; htmlUrl: string };

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

/**
 * At most this many matches per idea. A duplicate pair is the thing being
 * surfaced; a card listing eight "similar" issues is a wall of text, not a
 * triage aid. Three leaves room for the genuine cluster case without becoming
 * a search-results panel.
 */
const MAX_MATCHES_PER_IDEA = 3;

/**
 * How long a loaded index is reused. The index only changes when someone
 * re-runs `scripts/ml/build-index.mjs`, so this is generous; it exists to keep
 * a page refresh from re-fetching 1.2 MB from S3, not to track anything live.
 */
const INDEX_TTL_MS = 10 * 60_000;

/** A failed load is cached too, briefly, so a broken S3 is not retried per request. */
const FAILURE_TTL_MS = 60_000;

/**
 * The Ideas screen must never wait on this. If the artifact store has not
 * answered in this long, the request gives up and renders without duplicates;
 * the in-flight load keeps going and populates the cache for next time.
 */
const LOAD_TIMEOUT_MS = 4_000;

/* ------------------------------------------------------------------ */
/* Loading (memoised, never throws to the caller)                      */
/* ------------------------------------------------------------------ */

type ScoringContext = {
  backend: IndexBackend;
  index: EmbeddingIndex;
  vectors: Map<number, number[]>;
  source: ArtifactSource;
  threshold: number;
  thresholdSource: "metrics" | "builtin";
};

let cache: { at: number; promise: Promise<ScoringContext | null> } | null = null;

/**
 * Titan first, MiniLM second.
 *
 * Titan is the index the deployed Lambda scores against and the one the 0.842
 * operating point was swept for, so preferring it keeps the product's numbers
 * comparable with the service's. MiniLM is the fallback rather than a silent
 * substitute: the backend that answered is carried through to the report, and
 * the threshold moves WITH it (0.828, its own swept operating point), because a
 * threshold calibrated for one encoder means nothing applied to another.
 *
 * Note this is exactly the fallback `embed.ts` refuses to make — and for the
 * opposite reason. There, falling back would mislabel which model produced a
 * number. Here the model is reported and the threshold follows it, so nothing
 * is mislabelled; the alternative is not "a more honest answer", it is no
 * answer at all.
 */
async function loadIndexPreferringTitan(): Promise<{
  backend: IndexBackend;
  index: EmbeddingIndex;
  source: ArtifactSource;
} | null> {
  for (const backend of ["titan", "local"] as const) {
    try {
      const { index, source } = await loadEmbeddingIndex(backend);
      return { backend, index, source };
    } catch (err) {
      console.warn(
        `[dedup] ${backend} embedding index unavailable: ` +
          `${(err as { message?: string })?.message ?? err}`,
      );
    }
  }
  return null;
}

/**
 * The swept operating point for `backend`, out of the metrics artifact when it
 * can be read and the built-in constant when it cannot. Never throws.
 */
async function thresholdFor(
  backend: IndexBackend,
): Promise<{ threshold: number; thresholdSource: "metrics" | "builtin" }> {
  try {
    const { value } = await loadJsonArtifact<DedupEvalMetrics>("metrics");
    const swept =
      value?.results?.duplicate?.[METHOD_FOR[backend]]?.precision_first_operating_point
        ?.threshold;
    // A cosine threshold outside (0,1) is a corrupt or mis-keyed artifact, not
    // a new operating point — fall through to the constant rather than
    // silently reporting every pair or none of them.
    if (typeof swept === "number" && Number.isFinite(swept) && swept > 0 && swept < 1) {
      return { threshold: swept, thresholdSource: "metrics" };
    }
    console.warn(
      `[dedup] metrics artifact has no usable ${METHOD_FOR[backend]} operating point; ` +
        `using the built-in ${BUILTIN_THRESHOLD[backend]}`,
    );
  } catch (err) {
    console.warn(
      `[dedup] metrics artifact unavailable (${(err as { message?: string })?.message ?? err}); ` +
        `using the built-in ${BUILTIN_THRESHOLD[backend]}`,
    );
  }
  return { threshold: BUILTIN_THRESHOLD[backend], thresholdSource: "builtin" };
}

async function buildScoringContext(): Promise<ScoringContext | null> {
  const loaded = await loadIndexPreferringTitan();
  if (!loaded) return null;
  const { threshold, thresholdSource } = await thresholdFor(loaded.backend);
  return {
    backend: loaded.backend,
    index: loaded.index,
    vectors: indexToMap(loaded.index),
    source: loaded.source,
    threshold,
    thresholdSource,
  };
}

/** The memoised context, or null. Resolves rather than rejects on every failure. */
function scoringContext(): Promise<ScoringContext | null> {
  const now = Date.now();
  if (cache && now - cache.at < INDEX_TTL_MS) return cache.promise;

  const promise = buildScoringContext()
    .then((ctx) => {
      // Don't hold a null for the full TTL: a missing index is usually a
      // transient S3/credential problem, and ten minutes of "no duplicates" is
      // a long time to be wrong about.
      if (!ctx && cache?.promise === promise) cache.at = now - (INDEX_TTL_MS - FAILURE_TTL_MS);
      return ctx;
    })
    .catch((err) => {
      console.warn(
        `[dedup] could not build a scoring context: ${(err as { message?: string })?.message ?? err}`,
      );
      if (cache?.promise === promise) cache.at = now - (INDEX_TTL_MS - FAILURE_TTL_MS);
      return null;
    });

  cache = { at: now, promise };
  return promise;
}

/**
 * Start loading the index without waiting for it. `loadIdeas` calls this before
 * its GitHub fan-out so the artifact fetch overlaps with the eight issue
 * queries it is going to spend seconds on anyway, and the scoring step that
 * follows finds a warm cache.
 */
export function primeDuplicateIndex(): void {
  void scoringContext();
}

/** Drop the memoised index. Only needed by tests that swap env vars. */
export function resetDuplicateIndexCache(): void {
  cache = null;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/** Same rounding the Lambda applies, so the two report identical numbers. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * Score every idea in the queue against every other one and report the pairs at
 * or above the calibrated threshold.
 *
 * The comparison set is the QUEUE, not the whole 132-document corpus: the
 * question this screen answers is "does this proposal duplicate something
 * already waiting on me", and a match against a merged PR from three months ago
 * is a different question with a different answer. Only ideas the caller passed
 * in can be reported, so every link the UI renders points at something on the
 * screen.
 *
 * Never throws. `null` means "no duplicate information available", which the UI
 * renders as the absence of a badge — never as an error.
 */
export async function findQueueDuplicates(
  repo: { owner: string; repo: string },
  ideas: ScorableIdea[],
): Promise<DuplicateReport | null> {
  try {
    if (repo.owner !== INDEX_REPO.owner || repo.repo !== INDEX_REPO.repo) return null;

    // The four tabs can carry the same issue twice (an open-but-declined idea
    // rides along in `closed`), and comparing a document with itself would
    // score 1.0 and report every idea as its own duplicate.
    const unique = new Map<number, ScorableIdea>();
    for (const idea of ideas) {
      if (!unique.has(idea.number)) unique.set(idea.number, idea);
    }
    if (unique.size < 2) return null;

    const ctx = await withTimeout(scoringContext(), LOAD_TIMEOUT_MS, null);
    if (!ctx) return null;

    const scorable: ScorableIdea[] = [];
    const unindexed: number[] = [];
    for (const idea of unique.values()) {
      if (ctx.vectors.has(idea.number)) scorable.push(idea);
      else unindexed.push(idea.number);
    }
    unindexed.sort((a, b) => a - b);

    const pairs: Record<string, DuplicateMatch[]> = {};
    const add = (from: ScorableIdea, to: ScorableIdea, score: number) => {
      const key = String(from.number);
      (pairs[key] ??= []).push({
        number: to.number,
        title: to.title,
        htmlUrl: to.htmlUrl,
        score,
      });
    };

    for (let i = 0; i < scorable.length; i += 1) {
      for (let j = i + 1; j < scorable.length; j += 1) {
        const a = scorable[i];
        const b = scorable[j];
        const score = round4(
          cosineSim(ctx.vectors.get(a.number)!, ctx.vectors.get(b.number)!),
        );
        if (score < ctx.threshold) continue;
        // Recorded on BOTH cards. The relation is symmetric, and whichever card
        // the owner happens to be looking at is the one that has to say so.
        add(a, b, score);
        add(b, a, score);
      }
    }

    for (const key of Object.keys(pairs)) {
      pairs[key]!.sort((x, y) => y.score - x.score || x.number - y.number);
      pairs[key] = pairs[key]!.slice(0, MAX_MATCHES_PER_IDEA);
    }

    return {
      threshold: ctx.threshold,
      thresholdSource: ctx.thresholdSource,
      method: METHOD_FOR[ctx.backend],
      model: ctx.index.model,
      indexBuiltAt: ctx.index.builtAt,
      indexSource: ctx.source,
      scored: scorable.length,
      unindexed,
      pairs,
    };
  } catch (err) {
    // The Ideas screen is not allowed to break because an ML artifact moved.
    console.warn(
      `[dedup] queue duplicate scan skipped: ${(err as { message?: string })?.message ?? err}`,
    );
    return null;
  }
}
