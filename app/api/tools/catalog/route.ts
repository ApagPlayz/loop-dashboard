import { NextResponse } from "next/server";
import { loadCatalog, deriveRequestedIds } from "@/lib/tool-catalog";
import { listToolInstallPrs } from "@/lib/tools";
import { resolveProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * GET /api/tools/catalog?project=<key>
 *
 * The tool marketplace catalog. The catalog itself is GLOBAL (it isn't read
 * from any project's repo), so it always renders.
 *
 * `requestedIds` — the ids of entries that already have an install in flight —
 * IS project-specific: it's derived from open tool-install PR titles/branches
 * on one repo. It used to read the pilot's PRs no matter which project was
 * selected, marking the wrong entries "already requested". Now it's computed
 * only for the project named in `?project=`, and simply left empty when no
 * project is given (never substituted with another project's repo).
 */
export async function GET(req: Request) {
  const catalog = await loadCatalog();
  const projectKey = new URL(req.url).searchParams.get("project");

  let requestedIds: string[] = [];
  if (projectKey) {
    try {
      const { repo } = await resolveProject(projectKey);
      const prs = await listToolInstallPrs(repo);
      const signals = prs.flatMap((p) => [p.title, p.branch]);
      requestedIds = deriveRequestedIds(catalog.entries, signals);
    } catch {
      // Unknown project or GitHub unreachable → show the catalog without
      // "already requested" flags rather than failing the whole browser.
      requestedIds = [];
    }
  }

  return NextResponse.json({
    generatedAt: catalog.generatedAt,
    entries: catalog.entries,
    requestedIds,
  });
}
