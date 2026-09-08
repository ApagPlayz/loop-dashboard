import { NextResponse } from "next/server";
import { scanLocalFolders } from "@/lib/local-folders";
import { isLocalModeEnabled } from "@/lib/local-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/local-scan
 * List the immediate subfolders of every configured scan root as onboarding
 * candidates, together with the roots themselves — the picker renders its
 * "folders being scanned" strip straight from this response rather than making
 * a second request that could disagree with the first.
 *
 * LOCAL-ONLY: when none of the roots can be read (e.g. on Vercel, where they
 * don't exist) it returns { localUnavailable: true, folders: [] } and the UI
 * shows a plain note instead of the picker.
 *
 * With LOOP_DASHBOARD_LOCAL_MODE off we return that same "not available here"
 * shape — and an EMPTY roots list — without touching the filesystem at all.
 * The empty list is what tells the picker this is the wrong machine entirely,
 * as opposed to the right machine with a root that's gone missing, which is
 * worth offering a fix for. `scanLocalFolders()` is never reached either way.
 */
export async function GET() {
  if (!isLocalModeEnabled()) {
    return NextResponse.json({ localUnavailable: true, baseDir: "", roots: [], folders: [] });
  }

  try {
    const scan = await scanLocalFolders();
    return NextResponse.json(scan);
  } catch (err) {
    console.error("projects/local-scan: failed", err);
    return NextResponse.json(
      { error: "Couldn't read your local project folders. Try again." },
      { status: 502 },
    );
  }
}
