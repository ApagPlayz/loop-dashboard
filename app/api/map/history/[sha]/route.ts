import { NextResponse } from "next/server";
import { getCommitPatches, WORKFLOWS_DIR } from "@/lib/map-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/map/history/[sha]?file=claude-scout.yml (file optional)
 * The diff of one commit, limited to workflow files (or to one file).
 * Returns: { url, patches: [{ filename, status, patch }] }
 */
export async function GET(req: Request, ctx: { params: Promise<{ sha: string }> }) {
  const { sha } = await ctx.params;
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return NextResponse.json({ error: "Invalid version id." }, { status: 400 });
  }
  const file = new URL(req.url).searchParams.get("file");
  const prefix = file ? `${WORKFLOWS_DIR}/${file}` : `${WORKFLOWS_DIR}/`;

  try {
    const { patches, url } = await getCommitPatches(sha, prefix);
    return NextResponse.json({ url, patches });
  } catch (err) {
    console.error(`history[${sha}]: diff failed`, err);
    return NextResponse.json(
      { error: "Couldn't load that change from GitHub. Try again." },
      { status: 502 },
    );
  }
}
