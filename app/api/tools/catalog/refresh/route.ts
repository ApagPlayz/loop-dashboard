import { NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import {
  loadCatalog,
  mergeCandidates,
  persistCatalog,
  titleize,
  type CatalogEntry,
} from "@/lib/tool-catalog";

export const dynamic = "force-dynamic";

/**
 * Refresh / scan the catalog for new candidates.
 *
 * Pulls fresh candidates from two keyless / already-authorized sources, merges
 * anything new into the catalog (marked "unreviewed"), best-effort persists the
 * result, and reports exactly what changed. No new secrets, no new packages.
 *
 *   1. GitHub API against modelcontextprotocol/servers `src/` (uses the existing
 *      GITHUB_TOKEN via the shared Octokit client).
 *   2. The public MCP registry API (no key). Parsed defensively; skipped on any
 *      hiccup so a registry change never breaks the scan.
 */
export async function POST() {
  const catalog = await loadCatalog();
  const candidates: CatalogEntry[] = [];
  const sources: { name: string; found: number; ok: boolean }[] = [];

  // ---- Source 1: official MCP reference servers repo -------------------------
  try {
    const found = await scanServersRepo();
    candidates.push(...found);
    sources.push({ name: "modelcontextprotocol/servers", found: found.length, ok: true });
  } catch {
    sources.push({ name: "modelcontextprotocol/servers", found: 0, ok: false });
  }

  // ---- Source 2: public MCP registry (no key) --------------------------------
  try {
    const found = await scanMcpRegistry();
    candidates.push(...found);
    sources.push({ name: "MCP registry", found: found.length, ok: true });
  } catch {
    sources.push({ name: "MCP registry", found: 0, ok: false });
  }

  const { merged, added } = mergeCandidates(catalog.entries, candidates);

  let persisted = false;
  if (added.length > 0) {
    persisted = await persistCatalog({
      generatedAt: new Date().toISOString().slice(0, 10),
      note: catalog.note,
      entries: merged,
    });
  }

  return NextResponse.json({
    scanned: candidates.length,
    addedCount: added.length,
    added: added.map((e) => ({ id: e.id, name: e.name, type: e.type, url: e.url })),
    persisted,
    sources,
  });
}

/* ------------------------------------------------------------------ */
/* Source 1: GitHub — modelcontextprotocol/servers                     */
/* ------------------------------------------------------------------ */

async function scanServersRepo(): Promise<CatalogEntry[]> {
  const res = await getOctokit().rest.repos.getContent({
    owner: "modelcontextprotocol",
    repo: "servers",
    path: "src",
  });
  if (!Array.isArray(res.data)) return [];

  return res.data
    .filter((item) => item.type === "dir")
    .map((item) => {
      const dir = item.name;
      return {
        id: `mcp-${dir.toLowerCase()}`,
        name: titleize(dir),
        type: "mcp",
        status: "unreviewed",
        url: `https://github.com/modelcontextprotocol/servers/tree/main/src/${dir}`,
        description: `Official MCP reference server "${titleize(dir)}" — auto-discovered from the servers repo. Not yet reviewed.`,
        goodFor: ["Newly discovered — open the link to see what it does"],
        features: ["Auto-discovered from the official MCP servers repo"],
        requirements: "Details not verified yet — review before installing.",
        popularity: "Found in the official modelcontextprotocol/servers repo.",
        lastVerified: "",
        discoveredFrom: "modelcontextprotocol/servers",
      } satisfies CatalogEntry;
    });
}

/* ------------------------------------------------------------------ */
/* Source 2: public MCP registry (no auth)                             */
/* ------------------------------------------------------------------ */

type RegistryServer = {
  name?: string;
  description?: string;
  repository?: { url?: string } | null;
};

async function scanMcpRegistry(): Promise<CatalogEntry[]> {
  const resp = await fetch("https://registry.modelcontextprotocol.io/v0/servers?limit=30", {
    headers: { accept: "application/json" },
    // Don't let a slow registry hang the whole scan.
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) return [];

  const data = (await resp.json()) as { servers?: RegistryServer[] };
  const servers = Array.isArray(data.servers) ? data.servers : [];

  const out: CatalogEntry[] = [];
  for (const s of servers) {
    const url = s.repository?.url?.trim();
    const rawName = s.name?.trim();
    if (!url || !rawName) continue;
    try {
      new URL(url);
    } catch {
      continue;
    }
    // Registry names look like "io.github.owner/name" — take the last segment.
    const shortName = rawName.split("/").pop() ?? rawName;
    out.push({
      id: `registry-${slugify(rawName)}`,
      name: titleize(shortName),
      type: "mcp",
      status: "unreviewed",
      url,
      description:
        (s.description?.trim() || `MCP server "${shortName}" from the public registry.`) +
        " Auto-discovered — not yet reviewed.",
      goodFor: ["Newly discovered — open the link to see what it does"],
      features: ["Listed in the public MCP registry"],
      requirements: "Details not verified yet — review before installing.",
      popularity: "Listed in the public MCP registry.",
      lastVerified: "",
      discoveredFrom: "registry.modelcontextprotocol.io",
    });
  }
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
