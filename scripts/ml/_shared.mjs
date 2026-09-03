/**
 * Shared plumbing for the dedup scripts: corpus/index loading, the four scoring
 * methods behind one interface, and a seeded RNG so every sampling decision in
 * this pipeline is reproducible.
 *
 * Lives in scripts/ rather than lib/ because it imports the two lib .ts modules
 * by explicit `.ts` path (Node 26 strips types natively) — a .ts file doing the
 * same would need `allowImportingTsExtensions`, which the app's tsconfig does
 * not set.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCorpus, buildOverlapIndex, buildBm25Index } from "../../lib/dedup/baseline.ts";
import { cosineSim } from "../../lib/dedup/embed.ts";
import { loadAllEmbeddingIndexes } from "../../lib/dedup/artifact-store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..", "..");
export const CORPUS_PATH = path.join(ROOT, "data", "corpus.jsonl");
// Backend-specific indexes (see build-index.mjs). EMBEDDINGS_PATH is the
// legacy single-file path from before the local/titan split — build-index.mjs
// still mirrors its most recent build there, so it is kept as a last-resort
// fallback in loadAllEmbeddings() below, not as the primary path.
export const EMBEDDINGS_LOCAL_PATH = path.join(ROOT, "data", "embeddings-local.json");
export const EMBEDDINGS_TITAN_PATH = path.join(ROOT, "data", "embeddings-titan.json");
export const EMBEDDINGS_PATH = path.join(ROOT, "data", "embeddings.json");
export const UNLABELED_PATH = path.join(ROOT, "data", "gold-pairs-unlabeled.jsonl");
export const LABELED_PATH = path.join(ROOT, "data", "gold-pairs.jsonl");
export const METRICS_PATH = path.join(ROOT, "metrics", "dedup-eval.json");

/** The labels the owner may write into the `label` field. */
export const LABELS = ["duplicate", "related", "unrelated"];

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export async function loadCorpus(file = CORPUS_PATH) {
  const raw = await fs.readFile(file, "utf-8");
  return parseCorpus(raw);
}

/** Returns the embedding index, or null when it has not been built yet. */
export async function loadEmbeddings(file = EMBEDDINGS_PATH) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Load every backend-specific embedding index that exists on disk, keyed
 * "local" / "titan". Either, both, or neither may be present — a missing one
 * is simply absent from the result, the same "absent, not zeroed" contract
 * `loadEmbeddings` already has for the single-index case. This is what lets
 * evaluate.mjs score MiniLM and Titan side by side in one run once both
 * indexes exist, and score just one (or neither, falling back to the lexical
 * baselines only) when only one has been built.
 *
 * Falls back to the legacy single-file data/embeddings.json ONLY when neither
 * backend-specific file exists, labelling it by the `backend` field the file
 * already carries — so a repo that has not re-run build-index.mjs since the
 * local/titan split still evaluates correctly.
 */
export async function loadAllEmbeddings() {
  // S3 first (with a per-artifact fallback to data/embeddings-*.json baked into
  // artifact-store itself), so this is not a second copy of that fallback logic
  // — it is the one loader, called from here.
  const out = await loadAllEmbeddingIndexes();
  const local = out.local ?? null;
  const titan = out.titan ?? null;

  if (!local && !titan) {
    const legacy = await loadEmbeddings(EMBEDDINGS_PATH);
    if (legacy) out[legacy.backend === "bedrock" ? "titan" : "local"] = legacy;
  }
  return out;
}

/** Read a .jsonl file into an array. Lines starting with `#` are comments. */
export async function readJsonl(file) {
  const raw = await fs.readFile(file, "utf-8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => JSON.parse(l));
}

/* ------------------------------------------------------------------ */
/* Methods                                                             */
/* ------------------------------------------------------------------ */

/** Build one cosine-similarity dense method from one embedding index. */
function buildDenseMethod(name, docs, embeddingIndex) {
  const vec = new Map();
  embeddingIndex.numbers.forEach((n, i) => vec.set(n, embeddingIndex.vectors[i]));
  const titles = new Map(docs.map((d) => [d.number, d.title]));
  const order = docs.map((d) => d.number);
  const score = (a, b) => {
    const va = vec.get(a);
    const vb = vec.get(b);
    if (!va || !vb) return 0;
    return cosineSim(va, vb);
  };
  return {
    name,
    scorePair: score,
    rank(queryNumber, topK) {
      const out = order
        .filter((n) => n !== queryNumber)
        .map((n) => ({ number: n, title: titles.get(n) ?? "", score: score(queryNumber, n) }));
      out.sort((x, y) => y.score - x.score || x.number - y.number);
      return typeof topK === "number" ? out.slice(0, topK) : out;
    },
  };
}

/**
 * Build every scoring method over the same corpus.
 *
 * Each method is `{ name, scorePair(a, b), rank(n, k) }`, so the harness can
 * treat the lexical baselines and every dense encoder identically — which is
 * the whole point: no method is handicapped by being wired up differently.
 *
 * `embeddings` accepts two shapes so both the old and new callers work:
 *   - a single index object (has `.numbers`) → one method named "dense",
 *     exactly the pre-split behaviour.
 *   - a `{ local?, titan?, ... }` map (what `loadAllEmbeddings()` returns) →
 *     one method per present key, named `dense_local` / `dense_titan` / …
 *
 * A backend absent from `embeddings` produces no method at all (never a
 * method that silently scores 0), so a run with only the local index built
 * simply omits `dense_titan` rather than reporting it as uniformly bad.
 */
export function buildMethods(docs, embeddings) {
  const methods = [
    buildOverlapIndex(docs, "raw"),
    buildOverlapIndex(docs, "normalized"),
    buildBm25Index(docs),
  ];

  const isSingleIndex = !!embeddings?.numbers;
  const indices = isSingleIndex ? { dense: embeddings } : embeddings || {};

  for (const [label, index] of Object.entries(indices)) {
    if (!index) continue;
    methods.push(buildDenseMethod(label === "dense" ? "dense" : `dense_${label}`, docs, index));
  }

  return methods;
}

/** Every unordered pair of document numbers, in a stable order. */
export function allPairs(docs) {
  const out = [];
  for (let i = 0; i < docs.length; i += 1) {
    for (let j = i + 1; j < docs.length; j += 1) {
      out.push([docs[i].number, docs[j].number]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Seeded RNG — every sample in this pipeline must be reproducible     */
/* ------------------------------------------------------------------ */

/** mulberry32. Small, fast, and good enough for sampling and bootstrapping. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates using a seeded RNG. Returns a new array. */
export function shuffled(arr, next) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Round for display without pretending to precision we don't have. */
export function r4(x) {
  return Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null;
}
