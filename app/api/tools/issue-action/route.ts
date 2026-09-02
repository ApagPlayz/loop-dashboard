import { NextResponse } from "next/server";
import { createComment, getOctokit } from "@/lib/github";
import { resolveProject, ProjectError } from "@/lib/projects";
import {
  MAX_RELAYED_CHARS,
  parseIssueNumber,
  pickAllowed,
  relayedBlock,
  sanitizeRelayedText,
} from "@/lib/relay-safety";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The only two things this route will do. Anything else is a bad request. */
const ACTIONS = ["close", "comment"] as const;

/**
 * Who wrote the fenced text, as told to the agent that reads it. The comment is
 * posted by the dashboard's GitHub token, so its author field says "admin" and
 * proves nothing about who typed the words.
 */
const RELAY_AUTHORS =
  "whoever typed into the dashboard's Tools page — this comment was posted by the dashboard's own GitHub token, which does NOT authenticate the person behind it";

/**
 * Act on an "Action needed" issue, in the caller's project.
 * Body:
 *   { project, action: "close", number }
 *   { project, action: "comment", number, body, wake?: boolean }  // wake adds "@claude"
 *
 * `project` is required: this route writes to a repo, and defaulting to the
 * pilot meant the Tools page could close or comment on the wrong project's
 * issue whenever the switcher was pointed somewhere else.
 *
 * SECURITY — why the comment body is sanitized and fenced.
 * `wake` posts a comment containing "@claude", which trips the target repo's
 * mention workflow. That workflow's authorization gate checks the COMMENT
 * AUTHOR's repository permission and accepts only admin/maintain — but the
 * comment author is this dashboard's own GitHub token, which IS an admin. So
 * the gate passes automatically for anything we post, and the text goes to a
 * job running with `contents: write`, `issues: write`, `actions: write` and
 * Bash in its allowed tools. The repo's own control is inverted into an
 * amplifier. Authentication on this route (see proxy.ts) is the first
 * defence; this is the second, for the cases where the first doesn't hold —
 * a guessed password, a future read-only/demo deployment. So: the caller's
 * text is length-capped, has its @-mentions defanged, and is fenced as data
 * with the repo's UNTRUSTED_OPEN/UNTRUSTED_CLOSE convention. The "@claude"
 * that wakes the agent is OUR text, outside the fence, and is the only
 * mention that survives.
 *
 * `wake: false` comments are fenced too, deliberately. They don't wake anything
 * themselves, but they sit in a thread that a LATER "@claude" will feed to the
 * agent in full — so an unfenced one is just a delayed version of the same
 * problem. The cost is a few lines of preamble on the issue; the alternative is
 * a comment whose safety depends on nobody ever waking that thread.
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

  const action = pickAllowed(body.action, ACTIONS);
  if (!action) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const num = parseIssueNumber(body.number);
  if (num === null) {
    return NextResponse.json({ error: "Missing issue number" }, { status: 400 });
  }

  if (body.wake !== undefined && typeof body.wake !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Everything the caller supplies is validated BEFORE any repo lookup or write,
  // so a malformed request never reaches GitHub at all.
  let commentBody = "";
  if (action === "comment") {
    const clean = sanitizeRelayedText(body.body, {
      emptyError: "Write a message first.",
      longError: `That message is too long — keep it under ${MAX_RELAYED_CHARS} characters.`,
    });
    if (!clean.ok) {
      return NextResponse.json({ error: clean.error }, { status: 400 });
    }
    const fenced = relayedBlock(clean.text, RELAY_AUTHORS);
    commentBody = body.wake ? `@claude\n\n${fenced}` : fenced;
  }

  try {
    const { repo } = await resolveProject(body.project);

    if (action === "close") {
      await getOctokit().rest.issues.update({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: num,
        state: "closed",
      });
      return NextResponse.json({ ok: true });
    }

    await createComment(num, commentBody, repo);
    return NextResponse.json({ ok: true });
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
