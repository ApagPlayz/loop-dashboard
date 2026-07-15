import { NextResponse } from "next/server";
import { atomicCommit, WORKFLOWS_DIR, type TreeChange } from "@/lib/map-history";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/map/loop-edit/apply
 * Commit an AI-drafted loop change to the target repo's main as ONE commit.
 *
 * Body: { summary: string, changes: [{ file, newContent }] }
 * Returns: { commitUrl }
 */
export async function POST(req: Request) {
  let repo;
  try {
    ({ repo } = await resolveProjectFromUrl(req.url));
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }

  let body: { summary?: string; changes?: { file?: string; newContent?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const changes: TreeChange[] = [];
  for (const c of body.changes ?? []) {
    const file = (c.file ?? "").trim();
    // Filenames only — no paths, no traversal.
    if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(file)) {
      return NextResponse.json({ error: `Invalid file name: ${file || "(empty)"}` }, { status: 400 });
    }
    if (typeof c.newContent !== "string" || c.newContent.trim() === "") {
      return NextResponse.json({ error: `Empty content for ${file}.` }, { status: 400 });
    }
    changes.push({ path: `${WORKFLOWS_DIR}/${file}`, content: c.newContent });
  }
  if (changes.length === 0) {
    return NextResponse.json({ error: "No changes to apply." }, { status: 400 });
  }

  const firstLine = (body.summary ?? "loop change").split("\n")[0].trim();
  const short = firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;

  try {
    const res = await atomicCommit(changes, `dashboard: AI loop edit — ${short}`, repo);
    return NextResponse.json({ ok: true, commitUrl: res.url });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 409 || status === 422) {
      return NextResponse.json(
        {
          error:
            "The workflows changed on GitHub while you were reviewing. Draft the change again to pick up the latest version.",
        },
        { status: 409 },
      );
    }
    console.error("loop-edit/apply: failed", err);
    return NextResponse.json({ error: "Couldn't save to GitHub. Try again." }, { status: 502 });
  }
}
