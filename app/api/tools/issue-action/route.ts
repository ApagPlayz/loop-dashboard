import { NextResponse } from "next/server";
import { createComment, getOctokit } from "@/lib/github";
import { resolveProject, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Act on an "Action needed" issue, in the caller's project.
 * Body:
 *   { project, action: "close", number }
 *   { project, action: "comment", number, body, wake?: boolean }  // wake prepends "@claude "
 *
 * `project` is required: this route writes to a repo, and defaulting to the
 * pilot meant the Tools page could close or comment on the wrong project's
 * issue whenever the switcher was pointed somewhere else.
 */
export async function POST(req: Request) {
  let body: {
    project?: string;
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
    const { repo } = await resolveProject(body.project);

    if (body.action === "close") {
      await getOctokit().rest.issues.update({
        owner: repo.owner,
        repo: repo.repo,
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
      await createComment(num, finalBody, repo);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json(
      { error: "That didn't go through. Please try again." },
      { status: 500 },
    );
  }
}
