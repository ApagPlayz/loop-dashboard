/**
 * Type declarations for the pure-ESM ingestion pipeline (lib/catalog-pipeline.mjs).
 * Only the exports the app/route + build script actually use are declared.
 */
import type { CatalogEntry } from "@/lib/tool-catalog";

export type PipelineStats = {
  sources: Record<string, number>;
  totalCandidates?: number;
};

export type AssembleStats = {
  total: number;
  byType: Record<string, number>;
  byTier: Record<string, number>;
};

/** A normalized candidate carries the CatalogEntry fields plus internal `_*` ranking fields. */
export type PipelineCandidate = CatalogEntry & {
  _stars?: number;
  _downloads?: number;
  _official?: boolean;
  _key?: string;
};

export function normalizeKey(url: string): string;

export function enrichSeed(seedEntries: CatalogEntry[], today: number): PipelineCandidate[];

export function runPipeline(opts?: {
  token?: string;
  pulsePages?: number;
  registryPages?: number;
  githubMax?: number;
  davilaMinDownloads?: number;
  log?: (m: string) => void;
  now?: number;
}): Promise<{ candidates: PipelineCandidate[]; stats: PipelineStats }>;

export function assembleCatalog(
  seedEnriched: PipelineCandidate[],
  candidates: PipelineCandidate[],
  opts?: { cap?: number },
): { entries: CatalogEntry[]; stats: AssembleStats };

export function stripInternal(e: PipelineCandidate): CatalogEntry;
