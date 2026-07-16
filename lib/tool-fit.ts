/**
 * "Find tools for a project" — scores every catalog tool (MCP server, skill,
 * plugin) 0–100 on how well it fits a chosen GitHub repo.
 *
 * How it works, end to end:
 *  1. buildRepoProfile()  — read the repo through the GitHub API (languages,
 *     topics, description, README excerpt, package.json deps) into a compact
 *     profile the AI can reason about.
 *  2. preRank()           — a cheap keyword/category overlap score orders the
 *     whole catalog so the most promising tools are AI-scored first.
 *  3. AI scoring          — the top slice is scored by the local Claude CLI (or
 *     the API fallback) in small batches; each tool gets a 0–100 score and a
 *     one-line reason. Anything past the AI budget keeps its pre-rank score,
 *     labelled a "quick estimate" in the UI.
 *  4. cache               — the finished result is cached per repo in the temp
 *     dir so re-opening is instant; a Re-scan forces a fresh pass.
 *
 * All of the GitHub reads are best-effort: a missing README or package.json
 * just means a thinner profile, never a failure.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getOctokit } from "./github";
import { loadCatalog, type CatalogEntry, type ToolType, type TrustTier } from "./tool-catalog";
import { aiStructuredCall, aiEnabled, AiError } from "./map-ai";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type RepoProfile = {
  owner: string;
  repo: string;
  description: string | null;
  primaryLanguage: string | null;
  languages: string[]; // most-used first
  topics: string[];
  dependencies: string[]; // package.json dep names (deps + devDeps)
  readmeExcerpt: string;
  fetchedAt: string;
};

export type ToolScore = {
  id: string;
  name: string;
  type: ToolType;
  url: string;
  trustTier?: TrustTier;
  categories?: string[];
  safetyFlags?: string[];
  /** 0–100 fit score. */
  score: number;
  /** One-line plain-English reason for the score. */
  reason: string;
  /** True = a quick keyword estimate (not individually AI-scored). */
  estimated: boolean;
};

export type ScanResult = {
  owner: string;
  repo: string;
  profile: RepoProfile;
  scored: ToolScore[]; // sorted, highest score first
  totalTools: number;
  aiScoredCount: number;
  /** False when no AI backend is available (every score is an estimate). */
  aiUsed: boolean;
  scannedAt: string;
};

export type ScanProgress = {
  phase: "profiling" | "ranking" | "scoring" | "done";
  done: number;
  total: number;
};

/** How many top pre-ranked tools we spend real AI scoring on. */
const AI_SCORE_LIMIT = 100;
/** Tools per AI call. */
const BATCH_SIZE = 20;
/** Per-batch AI timeout. */
const BATCH_TIMEOUT_MS = 4 * 60 * 1000;
/** Cache freshness — older than this and the UI nudges a re-scan (still shown). */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Repo profile                                                        */
/* ------------------------------------------------------------------ */

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // code fences
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
    .replace(/[#>*_`|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function buildRepoProfile(owner: string, repo: string): Promise<RepoProfile> {
  const octokit = getOctokit();

  // Core metadata (this one must succeed — it also proves the repo is readable).
  const meta = await octokit.rest.repos.get({ owner, repo });
  const description = meta.data.description ?? null;
  const primaryLanguage = meta.data.language ?? null;

  const [languages, topics, readme, pkg] = await Promise.all([
    octokit.rest.repos
      .listLanguages({ owner, repo })
      .then((r) =>
        Object.entries(r.data)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .map(([lang]) => lang),
      )
      .catch(() => [] as string[]),
    octokit.rest.repos
      .getAllTopics({ owner, repo })
      .then((r) => r.data.names ?? [])
      .catch(() => [] as string[]),
    octokit.rest.repos
      .getReadme({ owner, repo })
      .then((r) => Buffer.from(r.data.content, "base64").toString("utf-8"))
      .catch(() => ""),
    octokit.rest.repos
      .getContent({ owner, repo, path: "package.json" })
      .then((r) => {
        const d = r.data;
        if (Array.isArray(d) || d.type !== "file" || !("content" in d)) return null;
        return Buffer.from(d.content, "base64").toString("utf-8");
      })
      .catch(() => null),
  ]);

  let dependencies: string[] = [];
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      dependencies = [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
      ];
    } catch {
      dependencies = [];
    }
  }

  return {
    owner,
    repo,
    description,
    primaryLanguage,
    languages,
    topics,
    dependencies,
    readmeExcerpt: stripMarkdown(readme).slice(0, 1500),
    fetchedAt: new Date().toISOString(),
  };
}

/** Compact, token-cheap text form of the profile for the AI prompt. */
function profileText(p: RepoProfile): string {
  const lines = [`Repository: ${p.owner}/${p.repo}`];
  if (p.description) lines.push(`Description: ${p.description}`);
  if (p.languages.length) lines.push(`Languages: ${p.languages.join(", ")}`);
  else if (p.primaryLanguage) lines.push(`Language: ${p.primaryLanguage}`);
  if (p.topics.length) lines.push(`Topics: ${p.topics.join(", ")}`);
  if (p.dependencies.length)
    lines.push(`Key dependencies: ${p.dependencies.slice(0, 60).join(", ")}`);
  if (p.readmeExcerpt) lines.push(`README excerpt: ${p.readmeExcerpt}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Pre-ranking (cheap keyword overlap)                                 */
/* ------------------------------------------------------------------ */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((t) => t.length > 2);
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "you", "your", "can", "are",
  "use", "using", "used", "from", "into", "app", "api", "run", "runs", "get",
  "web", "new", "all", "any", "one", "com", "www", "http", "https", "github",
]);

/** Build the weighted keyword profile from a repo. */
function profileTokens(p: RepoProfile): Set<string> {
  const toks = new Set<string>();
  for (const l of p.languages) toks.add(l.toLowerCase());
  if (p.primaryLanguage) toks.add(p.primaryLanguage.toLowerCase());
  for (const t of p.topics) tokenize(t).forEach((x) => toks.add(x));
  for (const d of p.dependencies) tokenize(d).forEach((x) => toks.add(x));
  if (p.description) tokenize(p.description).forEach((x) => toks.add(x));
  tokenize(p.readmeExcerpt).forEach((x) => toks.add(x));
  for (const s of STOPWORDS) toks.delete(s);
  return toks;
}

function entryText(e: CatalogEntry): string {
  return [
    e.name,
    e.description,
    ...(e.categories ?? []),
    ...(e.goodFor ?? []),
    ...(e.features ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Raw overlap count between a catalog entry and the repo profile tokens. */
function overlapScore(e: CatalogEntry, profileToks: Set<string>): number {
  const seen = new Set(tokenize(entryText(e)));
  let hits = 0;
  for (const t of seen) if (profileToks.has(t)) hits += 1;
  // A tool's own rank/quality nudges ties so a well-known tool edges a niche one.
  const quality = typeof e.rankScore === "number" ? e.rankScore : 0.3;
  return hits + quality * 0.5;
}

type Ranked = { entry: CatalogEntry; raw: number };

function preRank(entries: CatalogEntry[], profile: RepoProfile): Ranked[] {
  const toks = profileTokens(profile);
  return entries
    .map((entry) => ({ entry, raw: overlapScore(entry, toks) }))
    .sort((a, b) => b.raw - a.raw);
}

/** Map a pre-rank raw score to a 0–100 "quick estimate" for un-AI-scored tools. */
function estimateScore(raw: number, maxRaw: number): number {
  if (maxRaw <= 0) return 25;
  // Compress into a modest 10–70 band so estimates never masquerade as strong
  // AI-confirmed fits.
  return Math.round(10 + Math.min(1, raw / maxRaw) * 60);
}

/* ------------------------------------------------------------------ */
/* AI scoring                                                          */
/* ------------------------------------------------------------------ */

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The tool's id, copied exactly." },
          score: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            description: "How well this tool fits THIS repo (0 = irrelevant, 100 = perfect).",
          },
          reason: {
            type: "string",
            description: "One short plain-English sentence explaining the score.",
          },
        },
        required: ["id", "score", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["scores"],
  additionalProperties: false,
} as const;

const SCORE_SYSTEM = `You rate how well developer tools fit ONE specific software project.

The tools are Claude Code add-ons — MCP servers, skills, and plugins — that an autonomous coding agent working on the project could use. You are given a profile of the project and a list of tools.

For each tool, give a fit score from 0 to 100:
- 90–100: directly and obviously useful for this exact project's stack and domain.
- 60–89: clearly relevant and likely helpful.
- 30–59: general-purpose or tangentially useful.
- 0–29: unrelated to this project.

Judge by the project's languages, frameworks, dependencies, domain, and what it clearly does. A generic tool (e.g. a web-search or filesystem MCP) is broadly useful but rarely a 90 unless the project's domain calls for it. Keep each reason to one short, plain sentence a non-technical owner can understand. Score every tool you are given, using its exact id.`;

async function scoreBatch(
  profile: string,
  batch: CatalogEntry[],
): Promise<Map<string, { score: number; reason: string }>> {
  const tools = batch.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
    categories: e.categories ?? [],
    goodFor: e.goodFor ?? [],
  }));

  const user = `PROJECT PROFILE:
${profile}

TOOLS TO SCORE (JSON):
${JSON.stringify(tools, null, 2)}

Score each tool for how well it fits this project. Return one entry per tool, using its exact id.`;

  const result = await aiStructuredCall<{
    scores: { id: string; score: number; reason: string }[];
  }>({
    system: SCORE_SYSTEM,
    user,
    toolName: "submit_scores",
    toolDescription: "Submit a fit score and one-line reason for each tool.",
    schema: SCORE_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: BATCH_TIMEOUT_MS,
  });

  const out = new Map<string, { score: number; reason: string }>();
  for (const s of result.scores ?? []) {
    if (!s || typeof s.id !== "string") continue;
    const score = Math.max(0, Math.min(100, Math.round(Number(s.score) || 0)));
    out.set(s.id, { score, reason: (s.reason ?? "").trim() || "Rated by the AI." });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

function toToolScore(e: CatalogEntry, score: number, reason: string, estimated: boolean): ToolScore {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    url: e.url,
    trustTier: e.trustTier,
    categories: e.categories,
    safetyFlags: e.safetyFlags,
    score,
    reason,
    estimated,
  };
}

/**
 * Run a full scan. `onProgress` is called as work advances so a background job
 * can surface live progress to the UI.
 */
export async function runScan(
  owner: string,
  repo: string,
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult> {
  onProgress?.({ phase: "profiling", done: 0, total: 0 });
  const profile = await buildRepoProfile(owner, repo);

  onProgress?.({ phase: "ranking", done: 0, total: 0 });
  const { entries } = await loadCatalog();
  const ranked = preRank(entries, profile);
  const maxRaw = ranked.length ? ranked[0].raw : 0;

  const useAi = aiEnabled();
  const scored: ToolScore[] = [];

  if (!useAi) {
    // No AI backend → everything is a keyword estimate. Still useful ordering.
    for (const { entry, raw } of ranked) {
      scored.push(toToolScore(entry, estimateScore(raw, maxRaw), "Quick keyword estimate (AI scoring unavailable).", true));
    }
    scored.sort((a, b) => b.score - a.score);
    const result: ScanResult = {
      owner, repo, profile, scored,
      totalTools: entries.length, aiScoredCount: 0, aiUsed: false,
      scannedAt: new Date().toISOString(),
    };
    writeCache(result);
    onProgress?.({ phase: "done", done: entries.length, total: entries.length });
    return result;
  }

  const toAiScore = ranked.slice(0, AI_SCORE_LIMIT);
  const estimatedOnly = ranked.slice(AI_SCORE_LIMIT);
  const total = toAiScore.length;
  onProgress?.({ phase: "scoring", done: 0, total });

  let done = 0;
  for (let i = 0; i < toAiScore.length; i += BATCH_SIZE) {
    const slice = toAiScore.slice(i, i + BATCH_SIZE);
    let scores: Map<string, { score: number; reason: string }>;
    try {
      scores = await scoreBatch(profileText(profile), slice.map((r) => r.entry));
    } catch (err) {
      // A single failing batch shouldn't sink the whole scan — fall back to
      // estimates for that batch and carry on.
      if (err instanceof AiError) console.warn("tool-fit: batch failed", err.message);
      else console.error("tool-fit: batch error", err);
      scores = new Map();
    }
    for (const { entry, raw } of slice) {
      const ai = scores.get(entry.id);
      if (ai) scored.push(toToolScore(entry, ai.score, ai.reason, false));
      else scored.push(toToolScore(entry, estimateScore(raw, maxRaw), "Quick keyword estimate.", true));
    }
    done += slice.length;
    onProgress?.({ phase: "scoring", done, total });
  }

  for (const { entry, raw } of estimatedOnly) {
    scored.push(toToolScore(entry, estimateScore(raw, maxRaw), "Quick keyword estimate (beyond the AI-scored top tools).", true));
  }

  scored.sort((a, b) => b.score - a.score);
  const aiScoredCount = scored.filter((s) => !s.estimated).length;
  const result: ScanResult = {
    owner, repo, profile, scored,
    totalTools: entries.length, aiScoredCount, aiUsed: true,
    scannedAt: new Date().toISOString(),
  };
  writeCache(result);
  onProgress?.({ phase: "done", done: total, total });
  return result;
}

/* ------------------------------------------------------------------ */
/* Per-repo cache                                                      */
/* ------------------------------------------------------------------ */

function cacheDir(): string {
  const dir = path.join(tmpdir(), "loop-dashboard-tool-fit");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return dir;
}

export function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

function cacheFile(owner: string, repo: string): string {
  const safe = repoKey(owner, repo).replace(/[^a-z0-9._-]/g, "_");
  return path.join(cacheDir(), `${safe}.json`);
}

function writeCache(result: ScanResult): void {
  try {
    writeFileSync(cacheFile(result.owner, result.repo), JSON.stringify(result), "utf-8");
  } catch (err) {
    console.warn("tool-fit: cache write failed", err);
  }
}

export function readCache(owner: string, repo: string): ScanResult | null {
  try {
    return JSON.parse(readFileSync(cacheFile(owner, repo), "utf-8")) as ScanResult;
  } catch {
    return null;
  }
}
