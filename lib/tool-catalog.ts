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

/** Title-case a discovered directory name for a friendly display name. */
export function titleize(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
