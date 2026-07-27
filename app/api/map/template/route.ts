import { NextResponse } from "next/server";
import {
  applyTemplateChanges,
  listTemplateFiles,
  listTemplateWorkflows,
  templateContentHash,
  TEMPLATE_FILE_TARGETS,
  TemplateError,
  type TemplateSection,
} from "@/lib/loop-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/template — the state of the new-project template, both halves.
 *
 * Returns: {
 *   exists: boolean,            // the workflows half has been seeded
 *   workflows: string[],        // .github/workflows/*.yml agent filenames
 *   files: [{ file, target, content, hash }],  // the other baseline files
 * }
 *
 * The workflows half is listed by name only — it's edited through the AI chat
 * editor, which fetches its own copies. The (small) files half ships its
 * content inline so the editor can show and edit it without a second round
 * trip; the server has already read it to list it.
 *
 * `hash` is the base version the editor opened. Send it back on POST as
 * `expectedHash` and a save that would overwrite someone else's change is
 * refused with a 409 instead of silently winning.
 */
export async function GET() {
  try {
    const [workflows, files] = await Promise.all([listTemplateWorkflows(), listTemplateFiles()]);
    const workflowNames = [...workflows.keys()].sort();
    return NextResponse.json({
      exists: workflowNames.length > 0,
      workflows: workflowNames,
      files: [...files.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, content]) => ({
          file,
          target: TEMPLATE_FILE_TARGETS[file] ?? null,
          content,
          hash: templateContentHash(content),
        })),
    });
  } catch (err) {
    console.error("template: read failed", err);
    return NextResponse.json(
      { error: "Couldn't read the template from GitHub. Try again." },
      { status: 502 },
    );
  }
}

/**
 * POST /api/map/template — save one template file by hand.
 *
 * Body: { file: string, section?: "workflows" | "files", newContent: string,
 *         summary?: string, expectedHash?: string }
 *
 * Direct (non-AI) editing of a single template file. The AI chat editor stays
 * the way to restructure the workflows; this is the plain "open it, change a
 * line, save" path the baseline files need.
 *
 * `expectedHash` is the `hash` the GET handed out for this file. If the stored
 * file has moved on, the save is refused with 409 and a plain-English message
 * rather than overwriting whatever landed in the meantime.
 *
 * Returns: { ok, commitUrl, hash }   — `hash` is the new base version.
 */
export async function POST(req: Request) {
  let body: {
    file?: string;
    section?: string;
    newContent?: string;
    summary?: string;
    expectedHash?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const file = (body.file ?? "").trim();
  if (!file) {
    return NextResponse.json({ error: "Missing file name." }, { status: 400 });
  }
  if (body.section !== undefined && body.section !== "workflows" && body.section !== "files") {
    return NextResponse.json({ error: "Unknown part of the template." }, { status: 400 });
  }
  const section = (body.section ?? "workflows") as TemplateSection;
  if (typeof body.newContent !== "string" || body.newContent.trim() === "") {
    return NextResponse.json({ error: `Empty content for ${file}.` }, { status: 400 });
  }

  const summary = (body.summary ?? `edit ${file}`).split("\n")[0].trim() || `edit ${file}`;
  const expectedHash =
    typeof body.expectedHash === "string" && body.expectedHash ? body.expectedHash : undefined;

  try {
    const res = await applyTemplateChanges(
      [{ file, section, newContent: body.newContent, expectedHash }],
      summary,
    );
    return NextResponse.json({
      ok: true,
      commitUrl: res.commitUrl,
      // The editor keeps editing after a save — hand it the new base version so
      // the next save is checked against what it just wrote.
      hash: templateContentHash(body.newContent),
    });
  } catch (err) {
    if (err instanceof TemplateError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("template: save failed", err);
    return NextResponse.json({ error: "Couldn't save to GitHub. Try again." }, { status: 502 });
  }
}
