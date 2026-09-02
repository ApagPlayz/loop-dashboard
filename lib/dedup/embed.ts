/**
 * Dense sentence embeddings for near-duplicate detection.
 *
 * Two interchangeable backends behind one interface (`embedTexts`), mirroring
 * the `cli | api | bedrock` switch in lib/map-ai.ts:
 *
 *   1. "local"   — @huggingface/transformers running Xenova/all-MiniLM-L6-v2
 *                  through onnxruntime, in-process. 384 dims, no API key, no
 *                  AWS, no network after the first run (the model is cached
 *                  under node_modules/@huggingface/transformers/.cache by
 *                  default — note that `npm ci` wipes it and the next run
 *                  re-downloads). This is the one that is implemented.
 *
 *                  MEASURED, not estimated: transformers v4 defaults to fp32
 *                  in Node, and the download is 90.4 MB (model.onnx) + 0.7 MB
 *                  (tokenizer.json). The backlog's "~23 MB" figure is the
 *                  int8-quantised variant — set EMBEDDING_DTYPE=q8 for that,
 *                  at some cost in embedding fidelity.
 *
 *   2. "bedrock" — Amazon Titan Text Embeddings V2 (amazon.titan-embed-text-v2:0)
 *                  via bedrock-runtime InvokeModel, through
 *                  `@aws-sdk/client-bedrock-runtime` (present as a transitive
 *                  dependency of `@anthropic-ai/bedrock-sdk` — see
 *                  node_modules/@aws-sdk/client-bedrock-runtime; not a direct
 *                  package.json dependency, so a lockfile change upstream could
 *                  remove it). 1024 dims by default (see BEDROCK_EMBEDDING_DIMS).
 *                  UNVERIFIED END TO END: there is no AWS account yet (backlog
 *                  §2), so this path typechecks and is unit-tested with a mocked
 *                  SDK client, but has never made a real InvokeModel call. It
 *                  does NOT silently fall back to local on failure — any Bedrock
 *                  error throws, so nothing can ever report "Bedrock results"
 *                  that came from the local model. Keeps the same contract as
 *                  "local" — L2-normalised Float32Array per input, same input
 *                  order — so the same eval harness runs unchanged over both.
 *
 * Selection: EMBEDDING_BACKEND = local | bedrock (default local).
 *
 * Contract for every backend:
 *   - returns one Float32Array per input, in input order
 *   - mean-pooled over tokens
 *   - L2-normalised, so cosine similarity is a plain dot product
 *
 * Deployment note (from the backlog): onnxruntime-node is unreliable on musl.
 * The Dockerfile is node:22-alpine; running the local backend in the container
 * will likely need node:22-slim.
 */

export type EmbeddingBackend = "local" | "bedrock";

/** Model id for the local backend. 384-dimensional, ~23 MB quantised. */
export const LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

/** Output dimensionality of the local model. */
export const EMBEDDING_DIMS = 384;

/** Default model id for the Bedrock backend. Override with EMBEDDING_BEDROCK_MODEL. */
export const BEDROCK_EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0";

/**
 * MiniLM truncates at 256 word-pieces. Feeding it more silently discards the
 * tail, so text is cut at a character budget that comfortably exceeds the token
 * limit — the truncation is the model's, but it is worth being explicit that
 * only roughly the first paragraph or two of a long issue is actually encoded.
 * This is a real limitation of the method, not a bug in the wiring.
 */
export const MAX_CHARS = 2000;

/** Which backend will actually be used. */
export function embeddingBackend(): EmbeddingBackend {
  const pref = (process.env.EMBEDDING_BACKEND ?? "local").toLowerCase();
  if (pref === "bedrock") return "bedrock";
  if (pref === "local" || pref === "") return "local";
  throw new Error(
    `Unknown EMBEDDING_BACKEND="${pref}". Valid values: local | bedrock.`,
  );
}

/**
 * ONNX weight precision for the local backend. "fp32" (the transformers
 * default in Node) is what every number in metrics/dedup-eval.json was
 * produced with; "q8" trades a little fidelity for a ~4x smaller download and
 * is the one to reach for in a container. Recorded in the index file so two
 * runs at different precisions can never be silently compared.
 */
export function embeddingDtype(): string {
  return (process.env.EMBEDDING_DTYPE ?? "fp32").toLowerCase();
}

/** A human-readable id for whatever produced a set of vectors. */
export function embeddingModelId(): string {
  return embeddingBackend() === "bedrock"
    ? (process.env.EMBEDDING_BEDROCK_MODEL ?? BEDROCK_EMBEDDING_MODEL)
    : LOCAL_EMBEDDING_MODEL;
}

/**
 * Output dimensionality of whichever backend is currently selected. Unlike
 * `EMBEDDING_DIMS` (a local-only constant kept for backward compatibility),
 * this reflects the Bedrock backend's configurable width too, so callers that
 * sanity-check "did I get the width I asked for" work for either backend.
 */
export function expectedEmbeddingDims(): number {
  return embeddingBackend() === "bedrock" ? BEDROCK_EMBEDDING_DIMS : EMBEDDING_DIMS;
}

export type EmbedOptions = {
  /** Documents per forward pass. Small corpus → this barely matters. */
  batchSize?: number;
  /** Called after each batch, for progress output. */
  onProgress?: (done: number, total: number) => void;
};

/* ------------------------------------------------------------------ */
/* Local backend                                                       */
/* ------------------------------------------------------------------ */

// `unknown`-typed handle to the transformers feature-extraction pipeline,
// created once and reused. Typed loosely on purpose: the pipeline's call
// signature is heavily overloaded and pinning it here would break on a minor
// version bump for no benefit.
type FeatureExtractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ dims: number[]; data: Float32Array | number[] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

async function getLocalExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const pipe = await pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL, {
        dtype: embeddingDtype(),
      } as Parameters<typeof pipeline>[2]);
      return pipe as unknown as FeatureExtractor;
    })();
  }
  return extractorPromise;
}

async function embedLocal(texts: string[], opts: EmbedOptions): Promise<Float32Array[]> {
  const extractor = await getLocalExtractor();
  const batchSize = opts.batchSize ?? 16;
  const out: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, MAX_CHARS));
    // pooling:"mean" + normalize:true is exactly the sentence-transformers
    // recipe all-MiniLM-L6-v2 was trained with; do not change one without the
    // other or the cosine scores stop being comparable to published numbers.
    const tensor = await extractor(batch, { pooling: "mean", normalize: true });
    const dims = tensor.dims;
    const width = dims[dims.length - 1];
    const flat = tensor.data instanceof Float32Array ? tensor.data : Float32Array.from(tensor.data);
    for (let r = 0; r < batch.length; r += 1) {
      out.push(flat.slice(r * width, (r + 1) * width));
    }
    opts.onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bedrock backend — Amazon Titan Text Embeddings V2                   */
/* ------------------------------------------------------------------ */

/**
 * Output dimensionality requested from Titan v2. Titan v2 is trained with
 * Matryoshka representation learning specifically so that 1024 (full width,
 * the API default), 512, and 256 are all valid truncations of ONE embedding
 * space — picking a smaller size is a cost/latency trade, not a different
 * model. This pipeline requests the full 1024: the corpus is 132 documents,
 * so the storage/latency difference to 256 dims is a few hundred KB and
 * nothing worth trading fidelity for, and staying at full width keeps
 * "which model" the only axis of variation in the local-vs-Titan comparison
 * rather than adding "which truncation" as a second one. Override with
 * EMBEDDING_BEDROCK_DIMENSIONS (must be 1024, 512, or 256) if cost ever
 * matters at a larger corpus size.
 */
export const BEDROCK_EMBEDDING_DIMS: number = (() => {
  const raw = process.env.EMBEDDING_BEDROCK_DIMENSIONS;
  if (!raw) return 1024;
  const n = Number(raw);
  if (![1024, 512, 256].includes(n)) {
    throw new Error(
      `EMBEDDING_BEDROCK_DIMENSIONS="${raw}" invalid. Titan v2 only accepts 1024, 512, or 256.`,
    );
  }
  return n;
})();

/**
 * Region for the Bedrock backend. DASHBOARD_AI_BEDROCK_REGION is the explicit
 * opt-in already used by lib/map-ai.ts's Bedrock path, so setting it once
 * configures both; AWS_REGION is what the AWS CLI/SDK and ECS task
 * definitions already set. Unlike map-ai.ts's `bedrockRegion()`, this does NOT
 * throw when neither is set — it defaults to us-east-1 (where Titan v2 is
 * available) per this feature's spec, since the dedup pipeline runs ad hoc
 * from a laptop shell that may not export either var.
 */
function bedrockRegion(): string {
  return process.env.DASHBOARD_AI_BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";
}

// Typed loosely (module shape, not the full client type) so this file does not
// need `@aws-sdk/client-bedrock-runtime`'s types at the top level — it is a
// transitive dependency (pulled in by @anthropic-ai/bedrock-sdk), not a direct
// one, and is imported lazily below so nothing pays for loading the AWS
// signing stack unless EMBEDDING_BACKEND=bedrock is actually selected.
type BedrockRuntimeClientLike = {
  send: (command: unknown) => Promise<{ body: { transformToString(encoding?: string): string } }>;
};

let bedrockClientPromise: Promise<BedrockRuntimeClientLike> | null = null;

async function getBedrockRuntimeClient(): Promise<BedrockRuntimeClientLike> {
  if (!bedrockClientPromise) {
    bedrockClientPromise = (async () => {
      let mod: typeof import("@aws-sdk/client-bedrock-runtime");
      try {
        mod = await import("@aws-sdk/client-bedrock-runtime");
      } catch (err) {
        throw new Error(
          "EMBEDDING_BACKEND=bedrock needs @aws-sdk/client-bedrock-runtime, which isn't " +
            "resolvable. It normally arrives transitively via @anthropic-ai/bedrock-sdk; if " +
            "that package was removed or its lockfile changed, this backend can no longer run.",
          { cause: err },
        );
      }
      const { BedrockRuntimeClient } = mod;
      // No credentials passed: falls through to the default AWS provider
      // chain (env vars, ~/.aws/credentials, SSO, ECS task role, IMDS) —
      // exactly like map-ai.ts's Bedrock path. Never an API key here.
      return new BedrockRuntimeClient({ region: bedrockRegion() }) as unknown as BedrockRuntimeClientLike;
    })();
  }
  return bedrockClientPromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Titan v2 embeds one document per InvokeModel call — no batch input. */
const BEDROCK_CONCURRENCY = 5;
const BEDROCK_MAX_RETRIES = 5;

/**
 * Embed one text via InvokeModel. Request/response shape is exactly AWS's
 * documented Titan v2 contract (verified against the published API reference,
 * not guessed):
 *   request  { inputText, dimensions, normalize }
 *   response { embedding: number[], inputTextTokenCount, embeddingsByType }
 * Retries with exponential backoff on throttling/timeout; anything else
 * (including a credentials or access-denied failure) is rethrown immediately
 * — this function never returns a result it did not get from Bedrock.
 */
async function embedOneBedrock(
  client: BedrockRuntimeClientLike,
  text: string,
): Promise<Float32Array> {
  const { InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const body = JSON.stringify({
    inputText: text.slice(0, MAX_CHARS),
    dimensions: BEDROCK_EMBEDDING_DIMS,
    normalize: true,
  });
  // embeddingModelId() (not BEDROCK_EMBEDDING_MODEL directly) so that an
  // EMBEDDING_BEDROCK_MODEL override actually changes which model gets called,
  // not just the label recorded in the index — a mismatch there would silently
  // mislabel results the same way a local→bedrock fallback would.
  const modelId = embeddingModelId();

  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await client.send(
        new InvokeModelCommand({
          modelId,
          contentType: "application/json",
          accept: "application/json",
          body,
        }),
      );
      const parsed = JSON.parse(res.body.transformToString("utf-8")) as {
        embedding?: number[];
      };
      if (!Array.isArray(parsed.embedding) || parsed.embedding.length !== BEDROCK_EMBEDDING_DIMS) {
        throw new Error(
          `Titan v2 returned ${parsed.embedding?.length ?? "no"} dims, expected ${BEDROCK_EMBEDDING_DIMS}. ` +
            `Raw response: ${res.body.transformToString("utf-8").slice(0, 300)}`,
        );
      }
      return Float32Array.from(parsed.embedding);
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      const retryable = name === "ThrottlingException" || name === "ModelTimeoutException";
      if (retryable && attempt < BEDROCK_MAX_RETRIES) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      throw new Error(
        `Bedrock InvokeModel failed for ${modelId} (region ${bedrockRegion()}): ` +
          `${(err as { message?: string })?.message ?? err}. Refusing to fall back to the local ` +
          "model — that would silently mislabel local results as Bedrock results.",
        { cause: err },
      );
    }
  }
}

/** Bounded-concurrency map over Titan's one-call-per-document API. */
async function embedBedrock(texts: string[], opts: EmbedOptions): Promise<Float32Array[]> {
  const client = await getBedrockRuntimeClient();
  const out: Float32Array[] = new Array(texts.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= texts.length) return;
      out[i] = await embedOneBedrock(client, texts[i]);
      completed += 1;
      opts.onProgress?.(completed, texts.length);
    }
  }

  const workerCount = Math.min(BEDROCK_CONCURRENCY, texts.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return out;
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Embed a list of texts. One L2-normalised Float32Array per input, in order.
 */
export async function embedTexts(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const backend = embeddingBackend();
  if (backend === "bedrock") return embedBedrock(texts, opts);
  return embedLocal(texts, opts);
}

/* ------------------------------------------------------------------ */
/* Similarity                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cosine similarity. Both backends return L2-normalised vectors, so this is a
 * dot product; it is written out longhand rather than assuming normalisation,
 * because an un-normalised vector sneaking in would otherwise produce
 * plausible-looking nonsense rather than an error.
 */
export function cosineSim(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/* ------------------------------------------------------------------ */
/* Index file format                                                   */
/* ------------------------------------------------------------------ */

/**
 * On-disk shape of `data/embeddings.json`.
 *
 * JSON, not a binary blob: 132 docs x 384 dims at 6 decimal places is ~1 MB,
 * which is nothing, and in exchange the index is greppable, diffable in git,
 * and needs no custom reader. A binary format would be the right call at
 * ~10^5 documents; at 10^2 it is premature.
 */
export type EmbeddingIndex = {
  model: string;
  backend: EmbeddingBackend;
  /** Weight precision the local backend ran at ("fp32" | "q8" | …). */
  dtype?: string;
  dims: number;
  /** ISO timestamp of the build. */
  builtAt: string;
  /** sha of the corpus file the index was built from, to catch staleness. */
  corpusSha256: string;
  /** Issue/PR numbers, aligned index-for-index with `vectors`. */
  numbers: number[];
  /** One row per document. */
  vectors: number[][];
};

/** Look up vectors by document number. */
export function indexToMap(index: EmbeddingIndex): Map<number, number[]> {
  const m = new Map<number, number[]>();
  index.numbers.forEach((n, i) => m.set(n, index.vectors[i]));
  return m;
}
