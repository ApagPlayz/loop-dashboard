import { NextResponse } from "next/server";
import { scanLocalFolders } from "@/lib/local-folders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/local-scan
 * List the immediate subfolders of the local Claude projects directory as
 * onboarding candidates. LOCAL-ONLY: when the directory doesn't exist (e.g.
 * on Vercel) it returns { localUnavailable: true, folders: [] } and the UI
 * shows a plain note instead of the picker.
 */
export async function GET() {
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
