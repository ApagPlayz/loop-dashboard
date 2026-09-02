#!/usr/bin/env node
/**
 * Step 2 of the dedup pipeline — embed the corpus.
 *
 * Reads `data/corpus.jsonl`, embeds every document with whichever backend
 * EMBEDDING_BACKEND selects (default "local" = Xenova/all-MiniLM-L6-v2 running
 * in-process via onnxruntime; "bedrock" = Amazon Titan Text Embeddings V2 via
 * AWS Bedrock), and writes a backend-specific index so both can coexist:
 *
 *   local   → data/embeddings-local.json
 *   bedrock → data/embeddings-titan.json
 *
 * Every run also mirrors its output to data/embeddings.json (whichever backend
 * ran last), so anything still reading the old single-file path keeps working.
 *
 * The first "local" run downloads the model (~23 MB quantised, ~90 MB fp32)
 * into the transformers cache; every later run is offline. Timing for both is
 * printed so the cost is on the record rather than estimated. The "bedrock"
 * backend needs AWS credentials (default provider chain) and Bedrock model
 * access to amazon.titan-embed-text-v2:0 in the target region.
 *
 * Usage:
 *   node scripts/ml/build-index.mjs                              # local
 *   EMBEDDING_BACKEND=bedrock node scripts/ml/build-index.mjs     # Titan v2, needs AWS
 *   node scripts/ml/compare-encoders.mjs                          # after both exist
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCorpus, docText } from "../../lib/dedup/baseline.ts";
import {
  embedTexts,
  embeddingBackend,
  embeddingModelId,
  embeddingDtype,
  expectedEmbeddingDims,
  MAX_CHARS,
} from "../../lib/dedup/embed.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CORPUS = path.join(ROOT, "data", "corpus.jsonl");

// Backend-specific output, so a local index and a Titan index can coexist and
// be scored side by side by evaluate.mjs. "titan" rather than "bedrock" for
// the filename because that is the actual model family being compared against
// MiniLM — "bedrock" is the AWS product name, not a model.
const OUT_BY_BACKEND = {
  local: path.join(ROOT, "data", "embeddings-local.json"),
  bedrock: path.join(ROOT, "data", "embeddings-titan.json"),
};
// Legacy single-file path from before the local/titan split. Every build also
// writes here so scripts that only know the old layout keep working; it always
// mirrors whichever backend was built most recently, so treat it as "the last
// index built", not "the local index".
const LEGACY_OUT = path.join(ROOT, "data", "embeddings.json");

/** 6 decimals is ~1e-6 precision on unit vectors — far below anything that
 *  moves a cosine score, and it halves the file size versus full precision. */
function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

async function main() {
  const raw = await fs.readFile(CORPUS, "utf-8");
  const docs = parseCorpus(raw);
  const corpusSha256 = createHash("sha256").update(raw).digest("hex");

  const backend = embeddingBackend();
  const model = embeddingModelId();
  const dtype = embeddingDtype();
  const expectedDims = expectedEmbeddingDims();
  const OUT = OUT_BY_BACKEND[backend];
  console.log(`Backend: ${backend}  model: ${model}  dtype: ${dtype}`);
  console.log(`Embedding ${docs.length} documents (truncated to ${MAX_CHARS} chars each) …`);

  const texts = docs.map((d) => docText(d));
  const truncated = texts.filter((t) => t.length > MAX_CHARS).length;

  const t0 = Date.now();
  const vectors = await embedTexts(texts, {
    batchSize: 16,
    onProgress: (done, total) => process.stdout.write(`\r  ${done}/${total}`),
  });
  const elapsedMs = Date.now() - t0;
  process.stdout.write("\n");

  if (vectors.length !== docs.length) {
    throw new Error(`Got ${vectors.length} vectors for ${docs.length} documents`);
  }
  const dims = vectors[0]?.length ?? 0;

  const index = {
    model,
    backend,
    dtype,
    dims,
    builtAt: new Date().toISOString(),
    corpusSha256,
    numbers: docs.map((d) => d.number),
    vectors: vectors.map((v) => Array.from(v, round6)),
  };

  const json = JSON.stringify(index);
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, json, "utf-8");
  // Backward-compat mirror: always the most recently built index, whichever
  // backend. Anything still reading data/embeddings.json directly keeps working.
  await fs.writeFile(LEGACY_OUT, json, "utf-8");
  const bytes = (await fs.stat(OUT)).size;

  // A quick sanity check that the vectors are actually unit-length — if mean
  // pooling or normalisation silently changed, this catches it here rather
  // than as a mysteriously flat PR curve three steps later.
  const norms = vectors.slice(0, 8).map((v) => {
    let s = 0;
    for (const x of v) s += x * x;
    return Math.sqrt(s);
  });
  const worst = Math.max(...norms.map((n) => Math.abs(n - 1)));

  console.log(`Wrote ${OUT}  (${(bytes / 1024).toFixed(0)} KB)`);
  console.log(`Wrote ${LEGACY_OUT}  (backward-compat mirror)`);
  console.log(
    `dims=${dims}${dims === expectedDims ? "" : ` (WARNING: expected ${expectedDims})`}  ` +
      `elapsed=${(elapsedMs / 1000).toFixed(1)}s  ` +
      `${(elapsedMs / docs.length).toFixed(0)} ms/doc  ` +
      `truncated=${truncated}/${docs.length}  ` +
      `max |‖v‖-1| over first 8 = ${worst.toExponential(2)}`,
  );
}

main().catch((err) => {
  console.error("build-index failed:", err?.message ?? err);
  process.exit(1);
});
