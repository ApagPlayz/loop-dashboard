import { NextResponse } from "next/server";
import { listCommitsForPath, WORKFLOWS_DIR } from "@/lib/map-history";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILE_RE = /^[A-Za-z0-9._-]+\.ya?ml$/;

/**
 * GET /api/map/history?file=claude-scout.yml   — commits touching one workflow
 * GET /api/map/history?scope=loop              — commits touching any workflow
 * Returns: { commits: [{ sha, message, date, url }] }
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const file = url.searchParams.get("file");
  const scope = url.searchParams.get("scope");

  let path: string;
  if (file) {
    if (!FILE_RE.test(file)) {
      return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
    }
    path = `${WORKFLOWS_DIR}/${file}`;
  } else if (scope === "loop") {
    path = WORKFLOWS_DIR;
  } else {
    return NextResponse.json({ error: "Missing file or scope." }, { status: 400 });
  }

  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const commits = await listCommitsForPath(path, { per_page: 30, repo });
    return NextResponse.json({ commits });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("history: list failed", err);
    return NextResponse.json(
      { error: "Couldn't load the history from GitHub. Try again." },
      { status: 502 },
    );
  }
}
