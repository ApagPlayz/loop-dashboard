import { NextResponse } from "next/server";
import { atomicCommit, WORKFLOWS_DIR, type TreeChange } from "@/lib/map-history";
import {
  applyTemplateChanges,
  isValidTemplateFileName,
  TemplateError,
  type TemplateFileEdit,
} from "@/lib/loop-template";
import { resolveProject, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/map/process-chat/apply
 * Commit the changes drafted in a chat turn as ONE commit.
 *
 * Body: {
 *   target: "template" | <project key>,
 *   summary: string,
 *   changes: [{ file, newContent, delete? }],
 * }
 * Template target → commits to config/loop-template/workflows/ in the
 * dashboard repo (add/modify/remove allowed). Project target → commits to
 * that repo's .github/workflows/ on main (modify only, like the loop editor).
 *
 * Returns: { ok, commitUrl }
 */
export async function POST(req: Request) {
  let body: {
    target?: string;
    summary?: string;
    changes?: { file?: string; newContent?: string; delete?: boolean }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const target = (body.target ?? "").trim();
  const summary = (body.summary ?? "process change").split("\n")[0].trim();
  const changes = body.changes ?? [];
  if (!target) {
    return NextResponse.json({ error: "Missing target." }, { status: 400 });
  }
  if (changes.length === 0) {
    return NextResponse.json({ error: "No changes to apply." }, { status: 400 });
  }

  /* ----- template: add / modify / remove under config/loop-template ---- */
  if (target === "template") {
    const edits: TemplateFileEdit[] = changes.map((c) => ({
      file: (c.file ?? "").trim(),
      newContent: c.delete ? null : (c.newContent ?? ""),
    }));
    try {
      const res = await applyTemplateChanges(edits, summary);
      return NextResponse.json({ ok: true, commitUrl: res.commitUrl });
    } catch (err) {
      if (err instanceof TemplateError) {
        return NextResponse.json({ error: err.message }, { status: err.httpStatus });
      }
      throw err;
    }
  }

  /* ----- project: modify existing workflow files only ------------------ */
  let repo;
  try {
    ({ repo } = await resolveProject(target));
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }

  const treeChanges: TreeChange[] = [];
  for (const c of changes) {
    const file = (c.file ?? "").trim();
    if (!isValidTemplateFileName(file)) {
      return NextResponse.json(
        { error: `Invalid file name: ${file || "(empty)"}` },
        { status: 400 },
      );
    }
    if (c.delete) {
      return NextResponse.json(
        { error: "A project's files can't be removed from here — only edited." },
        { status: 400 },
      );
    }
    if (typeof c.newContent !== "string" || c.newContent.trim() === "") {
      return NextResponse.json({ error: `Empty content for ${file}.` }, { status: 400 });
    }
    treeChanges.push({ path: `${WORKFLOWS_DIR}/${file}`, content: c.newContent });
  }

  const short = summary.length > 60 ? summary.slice(0, 57) + "..." : summary;
  try {
    const res = await atomicCommit(treeChanges, `dashboard: AI loop edit — ${short}`, repo);
    return NextResponse.json({ ok: true, commitUrl: res.url });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 409 || status === 422) {
      return NextResponse.json(
        {
          error:
            "The workflows changed on GitHub while you were reviewing. Ask for the change again to pick up the latest version.",
        },
        { status: 409 },
      );
    }
    console.error("process-chat/apply: failed", err);
    return NextResponse.json({ error: "Couldn't save to GitHub. Try again." }, { status: 502 });
  }
}
