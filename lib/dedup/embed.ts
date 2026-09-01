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
 *                  via bedrock-runtime InvokeModel. NOT IMPLEMENTED: there is no
 *                  AWS account yet (backlog §2). The stub throws a specific
 *                  error rather than silently falling back, so nothing can ever
 *                  report "Bedrock results" that came from the local model.
 *                  When it is implemented it must keep the same contract —
 *                  L2-normalised Float32Array per input, same input order — so
 *                  the same eval harness reruns unchanged and yields a
 *                  backend-comparison table for free.
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
    ? (process.env.EMBEDDING_BEDROCK_MODEL ?? "amazon.titan-embed-text-v2:0")
    : LOCAL_EMBEDDING_MODEL;
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
/* Bedrock backend — deliberately not implemented                      */
/* ------------------------------------------------------------------ */

/**
 * Placeholder for Titan Text Embeddings V2.
 *
 * To implement (once an AWS account exists and Bedrock model access is
 * approved — backlog §2):
 *   - `@aws-sdk/client-bedrock-runtime` → `InvokeModelCommand`
 *   - body: { inputText, dimensions: 1024, normalize: true }
 *   - one call per document (Titan v2 has no batch input); throttle for
 *     TooManyRequestsException
 *   - credentials come from the default AWS chain, exactly like map-ai.ts's
 *     bedrock path — never an API key
 *   - the vectors are 1024-dim, NOT 384, so `data/embeddings.json` must record
 *     the model id and dims (it does) and the eval must not mix the two.
 */
// `texts` is deliberately unused: it is the contract the real implementation
// must honour, and keeping it documents the signature where someone will come
// to write it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function embedBedrock(texts: string[]): Promise<Float32Array[]> {
  throw new Error(
    "EMBEDDING_BACKEND=bedrock is not implemented. There is no AWS account and no " +
      "Bedrock model access yet (see docs/backlog.md §2). Implement the Titan v2 " +
      "InvokeModel path in lib/dedup/embed.ts before setting this. Refusing to fall " +
      "back to the local model, because that would silently mislabel local results " +
      "as Bedrock results.",
  );
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
  if (backend === "bedrock") return embedBedrock(texts);
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
