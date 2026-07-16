import { NextResponse } from "next/server";
import { loadCatalog, deriveRequestedIds } from "@/lib/tool-catalog";
import { listToolInstallPrs } from "@/lib/tools";

export const dynamic = "force-dynamic";

/**
 * The tool marketplace catalog.
 *
 * Returns every catalog entry plus `requestedIds` — the ids of entries that
 * already appear to have an install in flight (derived cheaply from open
 * tool-install PR titles/branches, so we don't add any new tracking).
 */
export async function GET() {
  const catalog = await loadCatalog();

  let requestedIds: string[] = [];
  try {
    const prs = await listToolInstallPrs();
    const signals = prs.flatMap((p) => [p.title, p.branch]);
    requestedIds = deriveRequestedIds(catalog.entries, signals);
  } catch {
    // GitHub unreachable → just show the catalog without "already requested" flags.
    requestedIds = [];
  }

  return NextResponse.json({
    generatedAt: catalog.generatedAt,
    entries: catalog.entries,
    requestedIds,
  });
}
