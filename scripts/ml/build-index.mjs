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
import {
  ARTIFACTS,
  artifactBucket,
  contentAddressedKey,
  putObjectText,
} from "../../lib/dedup/artifact-store.ts";

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

/**
 * Should this build push its index to S3?
 *
 * Defaults to on whenever AWS credentials look present, because an index that
 * exists only on the laptop that built it is exactly the problem S3 is here to
 * fix — a build that quietly skips the upload leaves `latest.json` stale, which
 * is worse than not uploading at all. Explicit overrides both ways:
 *
 *   ML_ARTIFACT_UPLOAD=1|true|always   force on (and fail loudly if it can't)
 *   ML_ARTIFACT_UPLOAD=0|false|never   force off
 *
 * "Credentials look present" covers the two shapes this actually runs under:
 * static env keys (CI) and a named/default profile or SSO cache (this laptop).
 * It is a heuristic for *whether to try*, not a claim that the call will
 * succeed — a wrong guess surfaces as a real error from S3, not a silent skip.
 */
function shouldUpload() {
  const raw = (process.env.ML_ARTIFACT_UPLOAD ?? "").toLowerCase();
  if (["0", "false", "never", "off", "no"].includes(raw)) return false;
  if (["1", "true", "always", "on", "yes"].includes(raw)) return true;
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_ROLE_ARN ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
      process.env.HOME, // ~/.aws/credentials or the SSO cache may be there
  );
}

/**
 * Upload the freshly built index under two keys: the moving `latest.json` the
 * runtime loader reads, and an immutable content-addressed copy so a specific
 * build can be pinned by sha without depending on an S3 version id. The bucket
 * is versioned, so overwriting `latest.json` still preserves every prior build.
 *
 * Ordering matters: the content-addressed copy goes first, so `latest.json`
 * never points at a build whose archive copy failed to land.
 */
async function uploadIndex(backend, json) {
  const label = backend === "bedrock" ? "titan" : "local";
  const artifactName = backend === "bedrock" ? "embeddings-titan" : "embeddings-local";
  const latestKey = ARTIFACTS[artifactName].key;
  const sha = createHash("sha256").update(json).digest("hex");
  const bucket = artifactBucket();

  await putObjectText(contentAddressedKey(label, sha), json, "application/json");
  await putObjectText(latestKey, json, "application/json");

  console.log(`Uploaded s3://${bucket}/${contentAddressedKey(label, sha)}`);
  console.log(`Uploaded s3://${bucket}/${latestKey}  (sha256 ${sha.slice(0, 12)}…)`);
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

  // S3 is the source of truth; the local file is now the fallback copy. Upload
  // AFTER the local write so a failed upload still leaves a usable local index,
  // and let a failure be fatal rather than a warning — a build that reports
  // success while `latest.json` still points at the previous index is how a
  // stale artifact gets evaluated for a week without anyone noticing.
  if (shouldUpload()) {
    await uploadIndex(backend, json);
  } else {
    console.log("Skipped S3 upload (ML_ARTIFACT_UPLOAD disabled or no AWS credentials).");
  }
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
