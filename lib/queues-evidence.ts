/**
 * Demo-evidence pipeline.
 *
 * The Demo agent uploads an Actions artifact named EXACTLY
 *   demo-evidence-pr-<PR_NUMBER>
 * containing the contents of the `evidence/` folder (so `manifest.json` sits at
 * the zip root, media at `NN-name.png`, `video/NN-name.webm`, etc.).
 *
 * Here we: find that artifact (newest, unexpired), download the zip, unzip it in
 * memory, parse `evidence/manifest.json`, and expose individual files for a
 * streaming route to serve.
 *
 * Vercel note: serverless lambdas are stateless and short-lived, so this cache
 * only helps within a single warm instance / burst of requests. The correct,
 * always-works path is a fresh download+unzip per cold request; the cache just
 * avoids re-downloading the (potentially large) zip when the manifest fetch and
 * several file fetches land on the same warm lambda.
 */

import { unzipSync } from "fflate";
import { getOctokit, downloadArtifact, type RepoConfig } from "@/lib/github";
import type { EvidenceItem } from "@/lib/queues";

export type EvidenceManifest = {
  pr?: number;
  captured_at?: string;
  items: EvidenceItem[];
};

type Unzipped = {
  manifest: EvidenceManifest | null;
  files: Map<string, Uint8Array>;
  fetchedAt: number;
};

/* ---- tiny in-memory LRU (per warm lambda instance) ---- */

const CACHE = new Map<string, Unzipped>();
const MAX_ENTRIES = 3; // keep memory bounded — artifacts can be tens of MB
const TTL_MS = 5 * 60 * 1000; // re-check for newer artifacts after 5 min

/** Cache key: scope by repo so same-numbered PRs across projects don't collide. */
function cacheKey(repoConfig: RepoConfig, prNumber: number): string {
  return `${repoConfig.owner}/${repoConfig.repo}#${prNumber}`;
}

function cacheGet(key: string): Unzipped | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  // refresh LRU position
  CACHE.delete(key);
  CACHE.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: Unzipped) {
  CACHE.set(key, value);
  while (CACHE.size > MAX_ENTRIES) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
}

/* ---- artifact lookup + unzip ---- */

async function fetchAndUnzip(
  prNumber: number,
  repoConfig: RepoConfig,
): Promise<Unzipped | null> {
  const { owner, repo } = repoConfig;
  const key = cacheKey(repoConfig, prNumber);
  const cached = cacheGet(key);
  if (cached) return cached;

  const name = `demo-evidence-pr-${prNumber}`;
  const octokit = getOctokit();

  // The Actions REST API supports filtering artifacts by exact name.
  const res = await octokit.rest.actions.listArtifactsForRepo({
    owner,
    repo,
    name,
    per_page: 100,
  });

  const usable = res.data.artifacts
    .filter((a) => !a.expired)
    .sort(
      (a, b) =>
        +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0),
    );

  if (usable.length === 0) return null; // none, or all expired

  const zip = await downloadArtifact(usable[0].id, repoConfig);
  const entries = unzipSync(new Uint8Array(zip));

  const files = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith("/")) continue; // directory entry
    // Normalise: strip a leading "evidence/" if the uploader kept the folder.
    const key = path.replace(/^evidence\//, "");
    files.set(key, data);
  }

  let manifest: EvidenceManifest | null = null;
  const rawManifest = files.get("manifest.json");
  if (rawManifest) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(rawManifest));
      if (parsed && Array.isArray(parsed.items)) {
        manifest = parsed as EvidenceManifest;
      }
    } catch {
      manifest = null;
    }
  }

  const value: Unzipped = { manifest, files, fetchedAt: Date.now() };
  cacheSet(key, value);
  return value;
}

/** Return the parsed manifest for a PR, or null if no usable artifact exists. */
export async function loadEvidenceManifest(
  prNumber: number,
  repoConfig: RepoConfig,
): Promise<EvidenceManifest | null> {
  const bundle = await fetchAndUnzip(prNumber, repoConfig);
  return bundle?.manifest ?? null;
}

/** Return the raw bytes + content type for one file inside the evidence zip. */
export async function readEvidenceFile(
  prNumber: number,
  filePath: string,
  repoConfig: RepoConfig,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const bundle = await fetchAndUnzip(prNumber, repoConfig);
  if (!bundle) return null;

  const key = decodeURIComponent(filePath).replace(/^evidence\//, "");
  const bytes = bundle.files.get(key);
  if (!bytes) return null;

  return { bytes, contentType: contentTypeFor(key) };
}

/**
 * Content types we are willing to hand back for a file that came out of a CI
 * artifact — i.e. content this app did not author and cannot vouch for.
 *
 * `svg` is deliberately ABSENT. An SVG is an XML *document*: served as
 * `image/svg+xml` from our own origin and opened directly (or in an iframe),
 * any `<script>` inside it runs as us, with our cookies. A build agent that can
 * upload an evidence artifact could therefore store XSS on the dashboard's
 * origin. Falling through to `application/octet-stream` — which
 * `readEvidenceFile`'s caller pairs with `Content-Disposition: attachment`,
 * `nosniff` and a `default-src 'none'; sandbox` CSP — makes that inert.
 * Likewise no `html`, `xml`, `xhtml` or `pdf`: same class of problem.
 */
const EVIDENCE_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  webm: "video/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
};

/** True when the type is safe to render inline (image/video/audio only). */
export function evidenceRendersInline(contentType: string): boolean {
  return (
    contentType.startsWith("image/") ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/")
  );
}

export function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EVIDENCE_CONTENT_TYPES[ext] ?? "application/octet-stream";
}
