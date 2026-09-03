/**
 * Where the dedup pipeline's built artifacts actually live.
 *
 * Up to now every artifact (embedding indexes, the corpus, the eval metrics,
 * the LLM-labelled gold pairs) was read straight off the local filesystem by
 * scripts/ml/_shared.mjs, and the 1.2 MB Titan index was committed to git.
 * That does not survive contact with anything that isn't this laptop: a
 * container has no `data/` directory, and git is the wrong store for a
 * megabyte of float32 that is regenerated on every rebuild.
 *
 * So S3 is the source of truth and the local file is the fallback:
 *
 *   ML_ARTIFACT_STORE=s3     (default) — try S3, fall back to the local file
 *                                        if S3 is unreachable/unconfigured
 *   ML_ARTIFACT_STORE=local            — never touch the network
 *
 * The fallback is deliberately asymmetric with lib/dedup/embed.ts's Bedrock
 * path, which refuses to fall back at all. The difference matters: falling
 * back from Titan to MiniLM would silently mislabel *which model produced a
 * number*, which corrupts an evaluation. Falling back from S3 to the local
 * copy of the same bytes changes only *where the identical artifact was read
 * from*, which is a transport detail. Every fallback is still announced on
 * stderr rather than swallowed, and `loadArtifact` reports the source it used
 * so a caller that cares (the verification script, the eval harness) can
 * assert on it.
 *
 * Layout in the bucket — see docs/ml-artifacts-s3.md:
 *
 *   embeddings/local/latest.json     most recent MiniLM (384-dim) index
 *   embeddings/local/<sha256>.json   immutable, content-addressed archive
 *   embeddings/titan/latest.json     most recent Titan v2 (1024-dim) index
 *   embeddings/titan/<sha256>.json   immutable, content-addressed archive
 *   corpus/corpus.jsonl              the 132-document corpus
 *   metrics/dedup-eval.json          evaluation results
 *   gold-pairs/gold-pairs-llm.jsonl  LLM-labelled pairs
 *
 * The bucket has versioning on, so `latest.json` keeps its full history even
 * though the key is overwritten; the content-addressed copy exists so a run
 * can be pinned to an exact index by sha without depending on a version id.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { EmbeddingIndex } from "./embed";

/** Default bucket. Override with ML_ARTIFACT_BUCKET. */
export const DEFAULT_ARTIFACT_BUCKET = "loop-dashboard-ml-777164055831";

/** Repo root, resolved from this file's location (lib/dedup/ -> ../..). */
const ROOT = path.resolve(process.cwd());

export type ArtifactStoreMode = "s3" | "local";

/** Logical artifact names this module knows how to fetch. */
export type ArtifactName =
  | "embeddings-local"
  | "embeddings-titan"
  | "corpus"
  | "metrics"
  | "gold-pairs-llm";

/** Where a load actually came from. Returned, not inferred, so callers can assert. */
export type ArtifactSource = "s3" | "local";

type ArtifactSpec = {
  /** Key in the bucket. */
  key: string;
  /** Path relative to the repo root, used as the fallback and by build scripts. */
  localPath: string;
};

/**
 * The single place the key layout and the local paths are written down. Both
 * the runtime loader and scripts/ml/build-index.mjs's uploader read this, so
 * the two can never drift into disagreeing about where an artifact lives.
 */
export const ARTIFACTS: Record<ArtifactName, ArtifactSpec> = {
  "embeddings-local": {
    key: "embeddings/local/latest.json",
    localPath: "data/embeddings-local.json",
  },
  "embeddings-titan": {
    key: "embeddings/titan/latest.json",
    localPath: "data/embeddings-titan.json",
  },
  corpus: { key: "corpus/corpus.jsonl", localPath: "data/corpus.jsonl" },
  metrics: { key: "metrics/dedup-eval.json", localPath: "metrics/dedup-eval.json" },
  "gold-pairs-llm": {
    key: "gold-pairs/gold-pairs-llm.jsonl",
    localPath: "data/gold-pairs-llm.jsonl",
  },
};

/**
 * Content-addressed key for one build of an index. `latest.json` is the moving
 * pointer; this is the immutable copy. Kept next to the layout it belongs to
 * rather than inlined in the build script.
 */
export function contentAddressedKey(
  backend: "local" | "titan",
  sha256: string,
): string {
  return `embeddings/${backend}/${sha256}.json`;
}

export function artifactBucket(): string {
  return process.env.ML_ARTIFACT_BUCKET || DEFAULT_ARTIFACT_BUCKET;
}

/**
 * Region for the artifact bucket. Mirrors embed.ts's `bedrockRegion()`
 * precedence so one env var configures the whole ML path, and defaults to
 * us-east-1 (where the bucket actually is) rather than throwing — the dedup
 * scripts run from a laptop shell that may export neither.
 */
export function artifactRegion(): string {
  return (
    process.env.ML_ARTIFACT_REGION ||
    process.env.AWS_REGION ||
    process.env.DASHBOARD_AI_BEDROCK_REGION ||
    "us-east-1"
  );
}

/** Which store to try first. */
export function artifactStoreMode(): ArtifactStoreMode {
  const pref = (process.env.ML_ARTIFACT_STORE ?? "s3").toLowerCase();
  if (pref === "local") return "local";
  if (pref === "s3" || pref === "") return "s3";
  throw new Error(
    `Unknown ML_ARTIFACT_STORE="${pref}". Valid values: s3 | local.`,
  );
}

/* ------------------------------------------------------------------ */
/* S3 client                                                           */
/* ------------------------------------------------------------------ */

// Typed as the module shape rather than the concrete client, and imported
// lazily, so nothing pays for loading the AWS signing stack unless an artifact
// is actually fetched from S3 — the same treatment embed.ts gives
// @aws-sdk/client-bedrock-runtime.
type S3ClientLike = {
  send: (command: unknown) => Promise<{
    Body?: { transformToString(encoding?: string): Promise<string> };
  }>;
};

let s3ClientPromise: Promise<S3ClientLike> | null = null;

async function getS3Client(): Promise<S3ClientLike> {
  if (!s3ClientPromise) {
    s3ClientPromise = (async () => {
      const { S3Client } = await import("@aws-sdk/client-s3");
      // No credentials passed: default AWS provider chain (env vars,
      // ~/.aws/credentials, SSO, ECS task role, IMDS), same as embed.ts.
      return new S3Client({ region: artifactRegion() }) as unknown as S3ClientLike;
    })();
  }
  return s3ClientPromise;
}

/** Reset the memoised client. Only needed by tests that swap env vars. */
export function resetS3Client(): void {
  s3ClientPromise = null;
}

/** Fetch one key as text. Throws on any S3 failure — the caller decides. */
export async function getObjectText(key: string, bucket = artifactBucket()): Promise<string> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await getS3Client();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`s3://${bucket}/${key} returned an empty body`);
  return res.Body.transformToString("utf-8");
}

/** Upload one string. Used by scripts/ml/build-index.mjs. */
export async function putObjectText(
  key: string,
  body: string,
  contentType = "application/json",
  bucket = artifactBucket(),
): Promise<void> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await getS3Client();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export type LoadResult = {
  /** Raw file contents. */
  text: string;
  /** Where it actually came from, so callers can assert rather than assume. */
  source: ArtifactSource;
  /** s3://bucket/key or an absolute filesystem path. */
  location: string;
};

/**
 * Load one artifact as text, S3 first (unless ML_ARTIFACT_STORE=local), then
 * the local file. Throws only when BOTH are unavailable — and then the message
 * carries both failures, because "index not found" with no indication of which
 * store was even tried is the least useful possible error here.
 */
export async function loadArtifact(name: ArtifactName): Promise<LoadResult> {
  const spec = ARTIFACTS[name];
  const localAbs = path.join(ROOT, spec.localPath);
  const mode = artifactStoreMode();

  let s3Error: unknown = null;
  if (mode === "s3") {
    const bucket = artifactBucket();
    try {
      const text = await getObjectText(spec.key, bucket);
      return { text, source: "s3", location: `s3://${bucket}/${spec.key}` };
    } catch (err) {
      s3Error = err;
      console.warn(
        `[artifact-store] s3://${bucket}/${spec.key} unavailable ` +
          `(${(err as { message?: string })?.message ?? err}); falling back to ${spec.localPath}`,
      );
    }
  }

  try {
    const text = await fs.readFile(localAbs, "utf-8");
    return { text, source: "local", location: localAbs };
  } catch (localErr) {
    const localMsg = (localErr as { message?: string })?.message ?? localErr;
    if (s3Error) {
      throw new Error(
        `Artifact "${name}" unavailable from both stores. ` +
          `S3 (s3://${artifactBucket()}/${spec.key}): ` +
          `${(s3Error as { message?: string })?.message ?? s3Error}. ` +
          `Local (${localAbs}): ${localMsg}.`,
        { cause: s3Error },
      );
    }
    throw new Error(
      `Artifact "${name}" unavailable: ML_ARTIFACT_STORE=local and ${localAbs} could not be ` +
        `read (${localMsg}). Unset ML_ARTIFACT_STORE to try S3.`,
      { cause: localErr },
    );
  }
}

/** `loadArtifact` + JSON.parse, preserving the source it came from. */
export async function loadJsonArtifact<T>(
  name: ArtifactName,
): Promise<{ value: T; source: ArtifactSource; location: string }> {
  const { text, source, location } = await loadArtifact(name);
  try {
    return { value: JSON.parse(text) as T, source, location };
  } catch (err) {
    throw new Error(`Artifact "${name}" from ${location} is not valid JSON`, { cause: err });
  }
}

/**
 * Load one embedding index by backend label. Uses the same "local" / "titan"
 * labelling that scripts/ml/_shared.mjs's `loadAllEmbeddings()` already keys
 * its result by, so the two describe the same two indexes by the same names.
 *
 * The width recorded in the file is checked against the vectors actually
 * present: a truncated or half-written upload would otherwise sail through and
 * surface three steps later as a mysteriously bad PR curve.
 */
export async function loadEmbeddingIndex(
  backend: "local" | "titan",
): Promise<{ index: EmbeddingIndex; source: ArtifactSource; location: string }> {
  const name: ArtifactName = backend === "titan" ? "embeddings-titan" : "embeddings-local";
  const { value, source, location } = await loadJsonArtifact<EmbeddingIndex>(name);

  if (!Array.isArray(value?.vectors) || !Array.isArray(value?.numbers)) {
    throw new Error(`Embedding index from ${location} has no vectors/numbers arrays`);
  }
  if (value.vectors.length !== value.numbers.length) {
    throw new Error(
      `Embedding index from ${location} is inconsistent: ` +
        `${value.vectors.length} vectors vs ${value.numbers.length} numbers`,
    );
  }
  const actualDims = value.vectors[0]?.length ?? 0;
  if (value.dims !== actualDims) {
    throw new Error(
      `Embedding index from ${location} declares dims=${value.dims} but its ` +
        `first vector has ${actualDims} values — truncated or corrupt.`,
    );
  }
  return { index: value, source, location };
}

/**
 * Both indexes, keyed the way `loadAllEmbeddings()` keys them. A backend that
 * is unavailable from *both* stores is simply absent from the result — the
 * same "absent, not zeroed" contract the existing loader has, so a run with
 * only one index built scores that one rather than reporting the other as
 * uniformly bad.
 */
export async function loadAllEmbeddingIndexes(): Promise<
  Partial<Record<"local" | "titan", EmbeddingIndex>>
> {
  const out: Partial<Record<"local" | "titan", EmbeddingIndex>> = {};
  await Promise.all(
    (["local", "titan"] as const).map(async (backend) => {
      try {
        out[backend] = (await loadEmbeddingIndex(backend)).index;
      } catch {
        // Absent is a valid state; loadArtifact already warned on stderr.
      }
    }),
  );
  return out;
}
