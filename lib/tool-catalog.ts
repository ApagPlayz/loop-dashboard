/**
 * Server-side helpers for the Tool marketplace / catalog.
 *
 * The catalog is a plain JSON file (`config/tool-catalog.json`) checked into the
 * repo. Each entry describes a real MCP server, Claude Code skill, or plugin the
 * owner can browse and install into an agent with the existing tool-install
 * contract. The entry `url` is exactly what gets sent as the install payload.
 *
 * Two "sources of truth":
 *  - The bundled JSON (imported) is always available, even on a read-only
 *    serverless filesystem — it's the guaranteed baseline.
 *  - At runtime we ALSO try to read the file from disk, so a local `refresh`
 *    that appends newly-discovered candidates is reflected on the next load.
 *
 * We keep the dependency surface tiny: only Node's `fs`/`path` plus the existing
 * Octokit client. No YAML/parsers/new packages.
 */

import { promises as fs } from "fs";
import path from "path";
import seed from "@/config/tool-catalog.json";

export type ToolType = "mcp" | "skill" | "plugin";
export type ToolStatus = "reviewed" | "unreviewed";

/**
 * Trust tier shown as a badge on every card:
 *  - official   → made by Anthropic or listed in the official MCP registry
 *  - verified   → an established published vendor tool with real traction
 *  - community  → open-source community tool (auto-scanned, decent signals)
 *  - unreviewed → freshly auto-discovered, nobody's looked at it yet
 */
export type TrustTier = "official" | "verified" | "community" | "unreviewed";

export type CatalogEntry = {
  id: string;
  name: string;
  type: ToolType;
  status: ToolStatus;
  url: string;
  description: string;
  goodFor: string[];
  features: string[];
  requirements: string;
  popularity: string;
  lastVerified: string;
  /** Where an auto-discovered entry came from (set by the refresh scan). */
  discoveredFrom?: string;

  /* ---- fields added by the rebuilt ingestion pipeline (all optional so old
     entries and the hand-reviewed seed keep working unchanged) ---- */
  /** Trust badge shown on the card. */
  trustTier?: TrustTier;
  /** 0–1 ranking score = normalized(stars)*0.4 + normalized(downloads)*0.4 + (official/verified?0.2:0). */
  rankScore?: number;
  /** True when the source repo hasn't been updated in >9 months (hidden by default). */
  stale?: boolean;
  /** Plain-English reason the entry is flagged stale. */
  staleReason?: string;
  /** One or more plain-English category labels for the category filter. */
  categories?: string[];
  /** Plain-English red safety warnings (needs keys / can spend money / can delete). */
  safetyFlags?: string[];
  /** Which ingestion source produced this entry. */
  source?: string;
  /** The single best pick in its category. */
  recommended?: boolean;
};

type CatalogFile = {
  generatedAt: string;
  note?: string;
  entries: CatalogEntry[];
};

const CATALOG_PATH = path.join(process.cwd(), "config", "tool-catalog.json");

/** The bundled seed catalog — always available, even in a read-only runtime. */
export function seedCatalog(): CatalogFile {
  return seed as CatalogFile;
}

/**
 * Load the current catalog. Prefers the on-disk file (so a local refresh's
 * appended entries show up), falling back to the bundled seed if the file can't
 * be read (e.g. a read-only serverless filesystem).
 */
export async function loadCatalog(): Promise<CatalogFile> {
  try {
    const raw = await fs.readFile(CATALOG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as CatalogFile;
    if (Array.isArray(parsed.entries)) return parsed;
  } catch {
    // fall through to the bundled seed
  }
  return seedCatalog();
}

/**
 * Best-effort persist. Writes the merged catalog back to disk when the
 * filesystem is writable (local dev). On a read-only runtime this quietly
 * fails and the caller still returns the merged result for the session.
 * Returns true if the write succeeded.
 */
export async function persistCatalog(file: CatalogFile): Promise<boolean> {
  try {
    await fs.writeFile(CATALOG_PATH, JSON.stringify(file, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge freshly-discovered candidates into an existing catalog. A candidate is
 * "new" if neither its id nor its url already exists. New entries are appended
 * and marked `status: "unreviewed"` so the UI can flag them for a human look.
 * Returns the merged list plus just the entries that were added.
 */
export function mergeCandidates(
  existing: CatalogEntry[],
  candidates: CatalogEntry[],
): { merged: CatalogEntry[]; added: CatalogEntry[] } {
  const byId = new Set(existing.map((e) => e.id));
  const byUrl = new Set(existing.map((e) => normalizeUrl(e.url)));
  const added: CatalogEntry[] = [];

  for (const c of candidates) {
    if (byId.has(c.id) || byUrl.has(normalizeUrl(c.url))) continue;
    byId.add(c.id);
    byUrl.add(normalizeUrl(c.url));
    added.push(c);
  }

  return { merged: [...existing, ...added], added };
}

function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Work out which catalog entries have ALREADY been sent to the installer, using
 * only data we already have (open tool-install PR titles/branches). This is a
 * best-effort, cheap match: an entry counts as "requested" if any PR title or
 * branch contains its name or the repo slug from its url. Returns the set of
 * matching entry ids.
 */
export function deriveRequestedIds(
  entries: CatalogEntry[],
  prSignals: string[],
): string[] {
  const hay = prSignals.map((s) => s.toLowerCase());
  const requested: string[] = [];
  for (const e of entries) {
    const slug = repoSlug(e.url);
    const name = e.name.toLowerCase();
    const hit = hay.some(
      (h) => (slug.length > 2 && h.includes(slug)) || h.includes(name),
    );
    if (hit) requested.push(e.id);
  }
  return requested;
}

/** Extract a short matchable slug from a repo/homepage url (e.g. "playwright-mcp"). */
function repoSlug(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // For github.com/owner/repo → "repo"; otherwise the last path segment/host.
    if (u.hostname.includes("github.com") && parts.length >= 2) return parts[1].toLowerCase();
    return (parts[parts.length - 1] ?? u.hostname).toLowerCase();
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Cheap relevance shortlist (no AI)                                   */
/* ------------------------------------------------------------------ */

/** Split arbitrary text into deduped lowercase word tokens (>=3 chars). */
function tokenize(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3) seen.add(raw);
  }
  return [...seen];
}

/**
 * Rank catalog entries by cheap token-overlap relevance to `text` and return a
 * shortlist for prompting the drafting assistant — no AI, no network. Tokens
 * from `text` are matched against each entry's name/description/goodFor/
 * categories, with name and goodFor weighted higher. Any `alwaysIncludeIds`
 * (e.g. tools the owner already attached) are prepended and deduped regardless
 * of score. Returns at most `limit` entries (default 25).
 */
export function shortlistForText(
  text: string,
  opts?: { limit?: number; alwaysIncludeIds?: string[] },
): CatalogEntry[] {
  const limit = opts?.limit ?? 25;
  const always = opts?.alwaysIncludeIds ?? [];
  const entries = seedCatalog().entries;
  const byId = new Map(entries.map((e) => [e.id, e]));

  const tokens = tokenize(text);
  const scored = entries
    .map((e) => {
      const name = e.name.toLowerCase();
      const goodFor = (e.goodFor ?? []).join(" ").toLowerCase();
      const categories = (e.categories ?? []).join(" ").toLowerCase();
      const description = (e.description ?? "").toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (name.includes(t)) score += 3;
        if (goodFor.includes(t)) score += 2;
        if (categories.includes(t)) score += 2;
        if (description.includes(t)) score += 1;
      }
      return { entry: e, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Always-include entries first (in the order given), then top-scored, deduped.
  const out: CatalogEntry[] = [];
  const used = new Set<string>();
  for (const id of always) {
    const e = byId.get(id);
    if (e && !used.has(e.id)) {
      out.push(e);
      used.add(e.id);
    }
  }
  for (const { entry } of scored) {
    if (out.length >= limit) break;
    if (used.has(entry.id)) continue;
    out.push(entry);
    used.add(entry.id);
  }
  return out;
}

/** Title-case a discovered directory name for a friendly display name. */
export function titleize(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
