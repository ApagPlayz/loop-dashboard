import { NextResponse } from "next/server";
import { scanLocalFolders } from "@/lib/local-folders";
import { isLocalModeEnabled } from "@/lib/local-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/local-scan
 * List the immediate subfolders of the local Claude projects directory as
 * onboarding candidates. LOCAL-ONLY: when the directory doesn't exist (e.g.
 * on Vercel) it returns { localUnavailable: true, folders: [] } and the UI
 * shows a plain note instead of the picker.
 *
 * With LOOP_DASHBOARD_LOCAL_MODE off we return that same "not available here"
 * shape without touching the filesystem at all — the picker degrades to the
 * note it already knows how to show, and `scanLocalFolders()` is never reached.
 */
export async function GET() {
  if (!isLocalModeEnabled()) {
    return NextResponse.json({ localUnavailable: true, baseDir: "", folders: [] });
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
