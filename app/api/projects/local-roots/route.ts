import { NextResponse } from "next/server";
import { addRoot, removeRoot } from "@/lib/local-roots";
import { isLocalModeEnabled, localModeDisabledResponse } from "@/lib/local-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manage the directories the local-folder picker scans.
 *
 * There is no GET here on purpose: `/api/projects/local-scan` already returns
 * the current roots alongside the folders it found, so the picker has one
 * source of truth and one round trip instead of two that can disagree. Both
 * handlers below answer with the full updated list, so the UI never has to
 * re-fetch to redraw.
 *
 * LOCAL-ONLY: these decide which parts of the host filesystem the scanner may
 * read, so they 404 unless LOOP_DASHBOARD_LOCAL_MODE is on. The validation
 * itself (absolute, exists, inside the home directory, symlink-resolved before
 * that check, no overlap with an existing root) lives in lib/local-roots.ts —
 * this route only turns its `ok: false` into a 400 the picker shows inline.
 */

/** Pull the `path` field out of a JSON body, or null if the body is unusable. */
async function readPath(req: Request): Promise<string | null> {
  try {
    const body = (await req.json()) as { path?: unknown };
    return typeof body.path === "string" ? body.path : null;
  } catch {
    return null;
  }
}

/** POST /api/projects/local-roots — body { path } — add a folder to scan. */
export async function POST(req: Request) {
  if (!isLocalModeEnabled()) return localModeDisabledResponse();

  const wanted = await readPath(req);
  if (wanted === null) {
    return NextResponse.json({ error: "Type the full path of a folder to scan." }, { status: 400 });
  }

  try {
    const result = await addRoot(wanted);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, roots: result.roots });
  } catch (err) {
    console.error("projects/local-roots: add failed", err);
    return NextResponse.json({ error: "Couldn't save that folder. Try again." }, { status: 502 });
  }
}

/** DELETE /api/projects/local-roots — body { path } — stop scanning a folder. */
export async function DELETE(req: Request) {
  if (!isLocalModeEnabled()) return localModeDisabledResponse();

  const wanted = await readPath(req);
  if (wanted === null) {
    return NextResponse.json({ error: "Which folder should stop being scanned?" }, { status: 400 });
  }

  try {
    const result = await removeRoot(wanted);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, roots: result.roots });
  } catch (err) {
    console.error("projects/local-roots: remove failed", err);
    return NextResponse.json({ error: "Couldn't update the scan list. Try again." }, { status: 502 });
  }
}
