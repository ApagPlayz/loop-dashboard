import { NextResponse } from "next/server";
import { addLabel, removeLabel, createComment } from "@/lib/github";
import { listThreadComments, closeIssue } from "@/lib/queues";
import { resolveProject, resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** GET /api/ideas/[number]?project=<key> — the comment thread for one idea. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  const issueNumber = Number(number);
  if (!Number.isInteger(issueNumber)) {
    return NextResponse.json({ error: "Bad issue number" }, { status: 400 });
  }
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const comments = await listThreadComments(issueNumber, repo);
    return NextResponse.json({ comments });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

type ActionBody = {
  action: "approve" | "unapprove" | "redraft" | "reject";
  text?: string;
  project?: string;
};

/**
 * POST /api/ideas/[number] — mutate an idea.
 *  approve   : optional comment (e.g. an included chat transcript), add "approved", remove "proposal"
 *  unapprove : add "proposal", remove "approved"
 *  redraft   : comment owner feedback, add "redraft", remove "proposal"
 *  reject    : optional comment, close (not_planned)
 *
 * Body carries a `project` field so the mutation targets the right repo.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  const issueNumber = Number(number);
  if (!Number.isInteger(issueNumber)) {
    return NextResponse.json({ error: "Bad issue number" }, { status: 400 });
  }

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
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

  try {
    switch (body.action) {
      case "approve": {
        const text = (body.text ?? "").trim();
        if (text) {
          await createComment(issueNumber, text, repo);
        }
        await addLabel(issueNumber, "approved", repo);
        await removeLabel(issueNumber, "proposal", repo).catch(ignoreMissingLabel);
        return NextResponse.json({ ok: true });
      }
      case "unapprove": {
        await addLabel(issueNumber, "proposal", repo);
        await removeLabel(issueNumber, "approved", repo).catch(ignoreMissingLabel);
        return NextResponse.json({ ok: true });
      }
      case "redraft": {
        const text = (body.text ?? "").trim();
        if (!text) {
          return NextResponse.json(
            { error: "Feedback is required to send an idea back." },
            { status: 400 },
          );
        }
        await createComment(
          issueNumber,
          `**Owner feedback for redraft:**\n\n${text}`,
          repo,
        );
        await addLabel(issueNumber, "redraft", repo);
        await removeLabel(issueNumber, "proposal", repo).catch(ignoreMissingLabel);
        return NextResponse.json({ ok: true });
      }
      case "reject": {
        const text = (body.text ?? "").trim();
        if (text) {
          await createComment(issueNumber, text, repo);
        }
        await closeIssue(issueNumber, "not_planned", repo);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

function ignoreMissingLabel(err: unknown) {
  // Removing a label that isn't present returns 404 — harmless here.
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: number }).status === 404
  ) {
    return;
  }
  throw err;
}

function msg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "GitHub request failed. Try again in a moment.";
}
