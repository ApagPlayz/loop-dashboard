/**
 * Duplicate-detection inference endpoint (AWS Lambda, nodejs22.x, arm64).
 *
 * Turns the offline dedup pipeline (lib/dedup/embed.ts + scripts/ml/*) into a
 * live service:
 *
 *   POST { "title": "...", "body": "..." }
 *     -> embed the text with Amazon Titan Text Embeddings V2 on Bedrock
 *     -> dot-product it against the 132-document precomputed Titan index
 *     -> { matches: [{ number, type, title, score }], duplicate, threshold }
 *
 * Deliberately ZERO npm dependencies. The managed Node runtime bundles *some*
 * AWS SDK v3 clients, but the exact set is a moving target and
 * @aws-sdk/client-bedrock-runtime is not one you can count on. Rather than ship
 * a ~50 MB node_modules for two HTTP calls, this signs the two requests itself
 * with SigV4 over the runtime's global fetch. The deployment package is a
 * single file, so cold start is dominated by the S3 index fetch, not by module
 * loading.
 *
 * The embedding request/response shape is copied from lib/dedup/embed.ts
 * (embedOneBedrock) and MUST stay identical to it — the index this queries was
 * built by that code, and a mismatch in `dimensions`, `normalize`, or the
 * MAX_CHARS truncation would silently compare vectors from two different
 * spaces.
 */

import { createHmac, createHash } from "node:crypto";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const REGION = process.env.AWS_REGION || "us-east-1";
const MODEL_ID = process.env.EMBEDDING_BEDROCK_MODEL || "amazon.titan-embed-text-v2:0";
const DIMS = Number(process.env.EMBEDDING_BEDROCK_DIMENSIONS || 1024);

const INDEX_BUCKET = process.env.INDEX_BUCKET || "loop-dashboard-ml-777164055831";
const INDEX_KEY = process.env.INDEX_KEY || "embeddings/titan/latest.json";
const CORPUS_KEY = process.env.CORPUS_KEY || "corpus/corpus.jsonl";

/**
 * Mirrors lib/dedup/embed.ts's MAX_CHARS. The indexed vectors were built from
 * text truncated at this budget, so the query must be truncated the same way.
 */
const MAX_CHARS = 2000;

/**
 * Cosine score above which the top match is called a duplicate.
 *
 * 0.842 is the swept operating point for `dense_titan` in
 * metrics/dedup-eval.json: it is BOTH the best-F1 threshold and the
 * precision-first (target precision 0.90) threshold on the 150-pair gold set —
 * precision 0.909, recall 0.800, F1 0.851. The two sweeps landing on the same
 * value is the reason to trust it: there is no precision/recall tension to
 * resolve by hand here. Note the eval's own caveat — the threshold was chosen
 * on the data it is scored on, so it is optimistically biased at this sample
 * size, and the corpus-level (Horvitz-Thompson reweighted) recall is 0.583
 * rather than 0.800. Precision is the number that matters for this use: a
 * false "this is a duplicate" wastes a human's time reading an unrelated
 * issue, while a miss just leaves the status quo.
 */
const DEFAULT_THRESHOLD = Number(process.env.DEDUP_THRESHOLD || 0.842);

const DEFAULT_TOP_K = 5;

/* ------------------------------------------------------------------ */
/* SigV4                                                               */
/* ------------------------------------------------------------------ */

function hmac(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** RFC 3986 encoding — encodeURIComponent leaves !'()* alone, SigV4 does not. */
function uriEncode(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function credentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "No AWS credentials in the environment. In Lambda these come from the " +
        "execution role; locally, export them before running.",
    );
  }
  return { accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN };
}

/**
 * Sign and send one request.
 *
 * `pathSegments` are the RAW (unencoded) path segments. They get encoded once
 * for the URL and — for every service except S3 — twice for the canonical
 * request, which is the SigV4 rule that trips people up on Bedrock model ids
 * (the ":" in "amazon.titan-embed-text-v2:0" becomes %3A in the URL and %253A
 * in the string to sign).
 */
async function signedFetch({ service, host, method, pathSegments, body }) {
  const { accessKeyId, secretAccessKey, sessionToken } = credentials();
  const isS3 = service === "s3";

  const urlPath = "/" + pathSegments.map(uriEncode).join("/");
  const canonicalPath = isS3
    ? "/" + pathSegments.map(uriEncode).join("/")
    : "/" + pathSegments.map((s) => uriEncode(uriEncode(s))).join("/");

  const payload = body ?? "";
  const payloadHash = sha256Hex(payload);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;
  if (body) headers["content-type"] = "application/json";

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    canonicalPath,
    "", // no query string on either call
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${urlPath}`, {
    method,
    headers,
    body: body || undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${service} ${method} ${urlPath} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Bedrock: embed one query                                            */
/* ------------------------------------------------------------------ */

async function embedQuery(text) {
  // Same body as lib/dedup/embed.ts embedOneBedrock(): normalize:true means the
  // vector comes back L2-normalised, so cosine similarity is a plain dot product.
  const body = JSON.stringify({
    inputText: text.slice(0, MAX_CHARS),
    dimensions: DIMS,
    normalize: true,
  });

  const res = await signedFetch({
    service: "bedrock",
    host: `bedrock-runtime.${REGION}.amazonaws.com`,
    method: "POST",
    pathSegments: ["model", MODEL_ID, "invoke"],
    body,
  });

  const parsed = await res.json();
  if (!Array.isArray(parsed.embedding) || parsed.embedding.length !== DIMS) {
    throw new Error(
      `Titan v2 returned ${parsed.embedding?.length ?? "no"} dims, expected ${DIMS}.`,
    );
  }
  return Float32Array.from(parsed.embedding);
}

/* ------------------------------------------------------------------ */
/* Index: loaded once per container, reused across invocations         */
/* ------------------------------------------------------------------ */

let indexPromise = null;

async function s3GetText(key) {
  const res = await signedFetch({
    service: "s3",
    host: `${INDEX_BUCKET}.s3.${REGION}.amazonaws.com`,
    method: "GET",
    pathSegments: key.split("/"),
  });
  return res.text();
}

/**
 * Fetches the Titan index and the corpus metadata from S3 and flattens the 132
 * vectors into ONE Float32Array. A single contiguous buffer rather than 132
 * separate arrays: the scoring loop then walks memory linearly, and the whole
 * thing is 132 * 1024 * 4 = 541 KB.
 */
async function loadIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const started = Date.now();
      const [indexRaw, corpusRaw] = await Promise.all([
        s3GetText(INDEX_KEY),
        s3GetText(CORPUS_KEY),
      ]);

      const index = JSON.parse(indexRaw);
      if (index.dims !== DIMS) {
        throw new Error(`Index is ${index.dims}-dim but this function embeds at ${DIMS}.`);
      }
      if (index.model !== MODEL_ID) {
        throw new Error(`Index was built with ${index.model}, not ${MODEL_ID}.`);
      }

      const count = index.numbers.length;
      const flat = new Float32Array(count * DIMS);
      for (let i = 0; i < count; i += 1) flat.set(index.vectors[i], i * DIMS);

      // Corpus is only needed for the human-readable title/type on each match.
      const meta = new Map();
      for (const line of corpusRaw.split("\n")) {
        if (!line.trim()) continue;
        const doc = JSON.parse(line);
        meta.set(doc.number, { type: doc.type, title: doc.title });
      }

      return {
        numbers: index.numbers,
        flat,
        count,
        meta,
        model: index.model,
        builtAt: index.builtAt,
        corpusSha256: index.corpusSha256,
        loadMs: Date.now() - started,
      };
    })().catch((err) => {
      // Never cache a failed load — a transient S3 error would otherwise
      // poison the whole container for its lifetime.
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

function topMatches(index, query, topK) {
  const { flat, numbers, count, meta } = index;
  const scored = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const off = i * DIMS;
    let dot = 0;
    for (let d = 0; d < DIMS; d += 1) dot += query[d] * flat[off + d];
    const number = numbers[i];
    const m = meta.get(number) || {};
    scored[i] = {
      number,
      type: m.type ?? null,
      title: m.title ?? null,
      score: Math.round(dot * 10000) / 10000,
    };
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

function parseInput(event) {
  // Function URL (payload format 2.0) wraps the request; a direct
  // `aws lambda invoke` passes the object through as-is. The proposal's own
  // field is also called "body", so key off requestContext, not off `body`.
  if (event && event.requestContext && event.requestContext.http) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";
    if (!raw.trim()) throw new Error("Empty request body.");
    return { input: JSON.parse(raw), viaHttp: true };
  }
  return { input: event || {}, viaHttp: false };
}

function respond(viaHttp, statusCode, payload) {
  if (!viaHttp) {
    if (statusCode >= 400) {
      const err = new Error(payload.error || "error");
      err.name = "DedupInferenceError";
      throw err;
    }
    return payload;
  }
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export async function handler(event) {
  const t0 = Date.now();
  let viaHttp = false;
  try {
    const parsed = parseInput(event);
    viaHttp = parsed.viaHttp;
    const { title = "", body = "", topK, threshold } = parsed.input;

    const text = [title, body].filter(Boolean).join("\n\n").trim();
    if (!text) {
      return respond(viaHttp, 400, { error: "Provide at least one of `title` or `body`." });
    }

    const k = Math.min(Math.max(Number(topK) || DEFAULT_TOP_K, 1), 20);
    const thr = Number.isFinite(Number(threshold)) && threshold != null
      ? Number(threshold)
      : DEFAULT_THRESHOLD;

    const indexT0 = Date.now();
    const index = await loadIndex();
    const indexMs = Date.now() - indexT0;

    const embedT0 = Date.now();
    const query = await embedQuery(text);
    const embedMs = Date.now() - embedT0;

    const scoreT0 = Date.now();
    const matches = topMatches(index, query, k);
    const scoreMs = Date.now() - scoreT0;

    return respond(viaHttp, 200, {
      matches,
      duplicate: matches.length > 0 && matches[0].score >= thr,
      threshold: thr,
      model: index.model,
      indexed_documents: index.count,
      index_built_at: index.builtAt,
      timing_ms: {
        total: Date.now() - t0,
        index_load: indexMs,
        index_cold_load: index.loadMs,
        embed: embedMs,
        score: scoreMs,
      },
    });
  } catch (err) {
    console.error("dedup-infer failed:", err);
    return respond(viaHttp, 500, { error: String(err && err.message ? err.message : err) });
  }
}
