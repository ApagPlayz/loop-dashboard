import { NextResponse } from "next/server";
import {
  loadCatalog,
  mergeCandidates,
  persistCatalog,
  type CatalogEntry,
} from "@/lib/tool-catalog";
// The pipeline is a pure ESM module shared with scripts/build-catalog.mjs so the
// live scan and the committed build use exactly the same ingestion + filters.
// Types come from the companion declaration file (lib/catalog-pipeline.d.ts).
import { runPipeline } from "@/lib/catalog-pipeline.mjs";

export const dynamic = "force-dynamic";
// The scan hits several external APIs with retries; give it room.
export const maxDuration = 60;

/**
 * Live "Scan for new tools" — runs the same ingestion pipeline the committed
 * catalog is built with (PulseMCP, davila7 aggregate, Anthropic official plugins
 * & skills, the official MCP registry, joined to GitHub for popularity/staleness),
 * but LIGHTER so it fits in a single request: fewer PulseMCP pages and a small
 * GitHub-join budget.
 *
 * Anything genuinely new (not already in the catalog by id or repo/package URL)
 * is appended and forced into the "unreviewed" trust tier + status, so the UI
 * flags it as "New — nobody's checked this yet". Existing hand-reviewed and
 * previously-scanned entries are never clobbered. Best-effort persist to disk;
 * on a read-only runtime it still returns the merged result for the session.
 */
export async function POST() {
  const catalog = await loadCatalog();

  let candidates: CatalogEntry[] = [];
  const sources: { name: string; found: number; ok: boolean }[] = [];
  try {
    const token = process.env.GITHUB_TOKEN;
    const { candidates: raw, stats } = await runPipeline({
      token,
      pulsePages: 3, // ~300 servers pre-filter — plenty for a live scan
      registryPages: 2,
      githubMax: 40, // keep the staleness join cheap in-request
      davilaMinDownloads: 20, // slightly stricter for the quick scan
      log: () => {},
    });
    candidates = raw as CatalogEntry[];
    const s = stats.sources as Record<string, number>;
    for (const [name, found] of Object.entries(s)) {
      sources.push({ name, found, ok: found > 0 });
    }
  } catch {
    // Whole pipeline failed → report nothing found, don't break the button.
    sources.push({ name: "ingestion pipeline", found: 0, ok: false });
  }

  // New scan-discovered entries always enter as "unreviewed" (tier + status).
  const marked = candidates.map((c) => ({
    ...c,
    status: "unreviewed" as const,
    trustTier: "unreviewed" as const,
  }));

  const { merged, added } = mergeCandidates(catalog.entries, marked);

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
