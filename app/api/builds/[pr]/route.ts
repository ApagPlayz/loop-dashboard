import { NextResponse } from "next/server";
import { createComment, mergePR, dispatchWorkflow } from "@/lib/github";
import { loadPRDetail, closePR } from "@/lib/queues";

export const dynamic = "force-dynamic";

/** GET /api/builds/[pr] — full detail: stats, verdict, demo evidence, thread. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pr: string }> },
) {
  const { pr } = await params;
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) {
    return NextResponse.json({ error: "Bad PR number" }, { status: 400 });
  }
  try {
    const detail = await loadPRDetail(prNumber);
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

type ActionBody = {
  action: "merge" | "sendback" | "close" | "comment" | "redemo";
  text?: string;
  wakeClaude?: boolean;
};

/**
 * POST /api/builds/[pr] — the decision row.
 *  merge    : squash-merge the PR
 *  sendback : required text → posts "@claude <changes>" so the mention agent fixes it
 *  close    : optional comment, then close without merging
 *  comment  : plain comment (optionally @claude to wake the agent)
 *  redemo   : dispatch claude-demo.yml with pr_number to (re)capture evidence
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ pr: string }> },
) {
  const { pr } = await params;
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) {
    return NextResponse.json({ error: "Bad PR number" }, { status: 400 });
  }

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "merge": {
        try {
          const result = await mergePR(prNumber, { merge_method: "squash" });
          return NextResponse.json({ ok: true, merged: result.merged });
        } catch (err) {
          // 405 = not mergeable (conflicts / checks); surface GitHub's message.
          const status =
            (err as { status?: number })?.status === 405 ? 409 : 502;
          return NextResponse.json({ error: msg(err) }, { status });
        }
      }
      case "sendback": {
        const text = (body.text ?? "").trim();
        if (!text) {
          return NextResponse.json(
            { error: "Describe the changes you want first." },
            { status: 400 },
          );
        }
        await createComment(prNumber, `@claude ${text}`);
        return NextResponse.json({ ok: true });
      }
      case "close": {
        const text = (body.text ?? "").trim();
        if (text) await createComment(prNumber, text);
        await closePR(prNumber);
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
        await createComment(
          prNumber,
          body.wakeClaude ? `@claude ${text}` : text,
        );
        return NextResponse.json({ ok: true });
      }
      case "redemo": {
        await dispatchWorkflow("claude-demo.yml", "main", {
          pr_number: String(prNumber),
        });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

function msg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "GitHub request failed. Try again in a moment.";
}
