import { NextResponse } from "next/server";
import {
  analyseBrief,
  resolveBriefPath,
  TEMPLATE_BRIEF_PATH,
  type BriefAnalysis,
} from "@/lib/brief";
import { commitFile, getFileContent } from "@/lib/github";
import { readTemplateFile } from "@/lib/loop-template";
import { resolveProject, resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BriefResponse = BriefAnalysis & { path: string; exists: boolean; content: string };

/**
 * GET /api/map/projects/brief?project=<key>
 *
 * Tells the caller whether the project's product brief exists, where it
 * lives (see the two legitimate paths in lib/brief.ts), and whether it's
 * actually filled in. When the repo has no brief yet, `content` is seeded
 * with the template's starter brief so a UI has something to put in a
 * textarea rather than an empty box.
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const path = await resolveBriefPath(repo);

    if (path === null) {
      const starter = (await readTemplateFile("files", "loop-brief.md")) ?? "";
      const analysis = analyseBrief(starter);
      const body: BriefResponse = {
        path: TEMPLATE_BRIEF_PATH,
        exists: false,
        content: starter,
        filled: false,
        unfilledSections: analysis.unfilledSections,
        totalSections: analysis.totalSections,
      };
      return NextResponse.json(body);
    }

    const content = await getFileContent(path, undefined, repo);
    if (content === null) {
      // Existed when resolveBriefPath probed it a moment ago, gone now —
      // someone deleted it in between. Rare enough to just surface as a
      // transient failure rather than re-deriving the "doesn't exist" shape.
      return NextResponse.json(
        { error: "The brief was there a moment ago and now isn't. Try again." },
        { status: 502 },
      );
    }

    const analysis = analyseBrief(content);
    const body: BriefResponse = {
      path,
      exists: true,
      content,
      filled: analysis.filled,
      unfilledSections: analysis.unfilledSections,
      totalSections: analysis.totalSections,
    };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("brief: GET failed", err);
    return NextResponse.json(
      { error: "Couldn't read the brief from GitHub. Try again." },
      { status: 502 },
    );
  }
}

/** The message shown when a save would leave the brief looking done when it isn't. */
function blankSectionsMessage(analysis: BriefAnalysis): string {
  const reason =
    analysis.unfilledSections.length > 0
      ? `These sections are still blank: ${analysis.unfilledSections.join(", ")}.`
      : "It doesn't have any content yet.";
  return `Can't save — the brief isn't filled in yet. ${reason}`;
}

/**
 * PUT /api/map/projects/brief
 * Body: { project: string, content: string }
 *
 * Commits `content` to the project's brief — the path resolveBriefPath()
 * finds, or the template's target (docs/loop-brief.md) when the repo has no
 * brief yet. Refuses to save a brief that still contains the placeholder:
 * the whole point of this endpoint is to stop a blank brief from being
 * treated as a done one, so this is the one save this app should not allow
 * to "succeed" quietly.
 */
export async function PUT(req: Request) {
  let body: { project?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  let repo;
  try {
    ({ repo } = await resolveProject(body.project));
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }

  if (typeof body.content !== "string" || body.content.trim() === "") {
    return NextResponse.json({ error: "The brief can't be empty." }, { status: 400 });
  }

  const analysis = analyseBrief(body.content);
  if (!analysis.filled) {
    return NextResponse.json({ error: blankSectionsMessage(analysis) }, { status: 400 });
  }

  try {
    const existingPath = await resolveBriefPath(repo);
    const path = existingPath ?? TEMPLATE_BRIEF_PATH;

    await commitFile(path, body.content, "dashboard: update product brief", { repo });

    const responseBody: BriefResponse = {
      path,
      exists: true,
      content: body.content,
      filled: analysis.filled,
      unfilledSections: analysis.unfilledSections,
      totalSections: analysis.totalSections,
    };
    return NextResponse.json(responseBody);
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 409 || status === 422) {
      return NextResponse.json(
        {
          error:
            "Someone else changed the brief while you were editing. Reopen it to get the latest version, then try again.",
        },
        { status: 409 },
      );
    }
    console.error("brief: PUT failed", err);
    return NextResponse.json({ error: "Couldn't save the brief to GitHub. Try again." }, { status: 502 });
  }
}
