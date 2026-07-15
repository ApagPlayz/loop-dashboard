import { NextResponse } from "next/server";
import {
  addLabel,
  removeLabel,
  createComment,
} from "@/lib/github";
import { listThreadComments, closeIssue } from "@/lib/queues";

export const dynamic = "force-dynamic";

/** GET /api/ideas/[number] — the comment thread for one idea. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  const issueNumber = Number(number);
  if (!Number.isInteger(issueNumber)) {
    return NextResponse.json({ error: "Bad issue number" }, { status: 400 });
  }
  try {
    const comments = await listThreadComments(issueNumber);
    return NextResponse.json({ comments });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

type ActionBody = {
  action: "approve" | "unapprove" | "redraft" | "reject" | "comment";
  text?: string;
  wakeClaude?: boolean;
};

/**
 * POST /api/ideas/[number] — mutate an idea.
 *  approve   : add "approved", remove "proposal"
 *  unapprove : add "proposal", remove "approved"
 *  redraft   : comment owner feedback, add "redraft", remove "proposal"
 *  reject    : optional comment, close (not_planned)
 *  comment   : plain comment (optionally prefixed @claude to wake the agent)
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

  try {
    switch (body.action) {
      case "approve": {
        await addLabel(issueNumber, "approved");
        await removeLabel(issueNumber, "proposal").catch(ignoreMissingLabel);
        return NextResponse.json({ ok: true });
      }
      case "unapprove": {
        await addLabel(issueNumber, "proposal");
        await removeLabel(issueNumber, "approved").catch(ignoreMissingLabel);
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
        );
        await addLabel(issueNumber, "redraft");
        await removeLabel(issueNumber, "proposal").catch(ignoreMissingLabel);
        return NextResponse.json({ ok: true });
      }
      case "reject": {
        const text = (body.text ?? "").trim();
        if (text) {
          await createComment(issueNumber, text);
        }
        await closeIssue(issueNumber, "not_planned");
        return NextResponse.json({ ok: true });
      }
      case "comment": {
        const text = (body.text ?? "").trim();
        if (!text) {
          return NextResponse.json(
            { error: "Write a comment first." },
            { status: 400 },
          );
        }
        const finalBody = body.wakeClaude ? `@claude ${text}` : text;
        await createComment(issueNumber, finalBody);
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
