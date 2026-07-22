import { NextResponse } from "next/server";
import { aiChatCall, assistantAvailable, AiError, type ChatMessage } from "@/lib/map-ai";
import { getIssue, listThreadComments } from "@/lib/queues";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHAT_TIMEOUT_MS = 60_000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;

/**
 * POST /api/ideas/[number]/chat?project=<key>
 * Body: { messages: { role: "user" | "assistant"; content: string }[] }
 * Returns: { reply: string }
 *
 * A private, local chat about ONE idea — never posted to GitHub. Scoped to
 * exactly this idea's text/discussion and which repo it belongs to; the local
 * CLI backend runs with tools fully disabled, so it cannot reach the
 * codebase even if asked to.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  if (!assistantAvailable()) {
    return NextResponse.json(
      { error: "AI chat needs the local Claude CLI, which isn't available right now." },
      { status: 503 },
    );
  }

  const { number } = await params;
  const issueNumber = Number(number);
  if (!Number.isInteger(issueNumber)) {
    return NextResponse.json({ error: "Bad issue number" }, { status: 400 });
  }

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const raw = Array.isArray(body.messages) ? body.messages : null;
  if (!raw || raw.length === 0) {
    return NextResponse.json({ error: "Send at least one message." }, { status: 400 });
  }
  if (raw.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: "This chat is getting long — start a fresh one." },
      { status: 400 },
    );
  }

  const messages: ChatMessage[] = [];
  for (const item of raw) {
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    const text = content.trim();
    if (!text) continue;
    if (text.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        { error: "That message is too long — please shorten it." },
        { status: 400 },
      );
    }
    messages.push({ role, content: text });
  }

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }

  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const [issue, comments] = await Promise.all([
      getIssue(issueNumber, repo),
      listThreadComments(issueNumber, repo),
    ]);

    const discussion = comments.length
      ? comments.map((c) => `${c.author}: ${c.body}`).join("\n\n")
      : "(no discussion yet)";

    const system = `You are a thinking-partner for the owner of ${repo.owner}/${repo.repo}, helping them think through ONE specific improvement idea before they decide whether to approve it, send it back with feedback, or reject it. This is a private conversation — nothing you say here gets posted anywhere unless the owner explicitly chooses to include it.

You are NOT connected to their codebase or any tools. You can only reason from the idea's text and the discussion below. If a question needs real codebase access you don't have, say so plainly instead of guessing.

THE IDEA — issue #${issue.number}, "${issue.title}" (labels: ${issue.labels.join(", ") || "none"}):
${issue.body || "(no description)"}

DISCUSSION SO FAR:
${discussion}

Answer the owner's questions plainly and honestly — be direct about risk, scope, feasibility, and whether this idea seems well-formed. You're here to help them decide, not to cheerlead.`;

    const reply = await aiChatCall({ system, messages, timeoutMs: CHAT_TIMEOUT_MS });
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("idea chat: failed", err);
    return NextResponse.json({ error: "Couldn't reach Claude. Try again." }, { status: 502 });
  }
}
