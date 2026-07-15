import { NextResponse } from "next/server";
import { createComment, getOctokit, REPOS } from "@/lib/github";

/**
 * Act on an "Action needed" issue.
 * Body:
 *   { action: "close", number }
 *   { action: "comment", number, body, wake?: boolean }  // wake prepends "@claude "
 */
export async function POST(req: Request) {
  let body: {
    action?: string;
    number?: number;
    body?: string;
    wake?: boolean;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const num = Number(body.number);
  if (!Number.isFinite(num)) {
    return NextResponse.json({ error: "Missing issue number" }, { status: 400 });
  }

  try {
    if (body.action === "close") {
      const { owner, repo } = REPOS.primary;
      await getOctokit().rest.issues.update({
        owner,
        repo,
        issue_number: num,
        state: "closed",
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "comment") {
      const text = (body.body ?? "").trim();
      if (!text) {
        return NextResponse.json({ error: "Write a message first." }, { status: 400 });
      }
      const finalBody = body.wake ? `@claude ${text}` : text;
      await createComment(num, finalBody);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json(
      { error: "That didn't go through. Please try again." },
      { status: 500 },
    );
  }
}
