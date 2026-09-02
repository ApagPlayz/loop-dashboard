import { NextResponse } from "next/server";
import {
  aiStructuredCall,
  aiEnabled,
  aiBackend,
  AiError,
  AI_DISABLED_MESSAGE,
  type ChatMessage,
} from "@/lib/map-ai";
import { getIssue, listThreadComments } from "@/lib/queues";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import { localCheckoutForRepo } from "@/lib/local-folders";
import {
  READONLY_TOOLS,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
  defuse,
  filesystemBoundary,
  untrustedPreamble,
} from "@/lib/prompt-safety";

export const dynamic = "force-dynamic";
// The CLI backend spawns a child process — keep this on the Node runtime.
export const runtime = "nodejs";
// One turn is a single synchronous AI call; give it a little more than the
// longest budget below so the platform doesn't kill it mid-answer.
export const maxDuration = 180;

const CHAT_TIMEOUT_MS = 60_000;
/** Longer budget when the assistant is actually reading code (multi-turn). */
const CODE_CHAT_TIMEOUT_MS = 150_000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;
/**
 * Only issues that are actually in the ideas queue may be discussed here.
 * Without this gate any issue number in the repo — including ones that have
 * nothing to do with the loop — could be pulled into a tool-enabled agent.
 */
const QUEUE_LABELS = ["proposal", "approved", "redraft", "declined"];

/**
 * POST /api/ideas/[number]/chat?project=<key>
 * Body: { messages: { role: "user" | "assistant"; content: string }[] }
 * Returns: { reply: string }
 *
 * A private, local chat about ONE idea — never posted to GitHub. Scoped to
 * this idea's text/discussion and its repo. When the project is checked out
 * locally AND the CLI backend is the one serving the call, the assistant gets
 * read-only tools (Read/Grep/Glob) with that checkout as its working directory
 * so it can verify claims against the ACTUAL code instead of guessing from the
 * idea's wording. Falls back to text-only otherwise — including on the API
 * backend, which ignores `cwd`/`tools` entirely.
 *
 * The issue's title, body and comments are third-party text (agents, bots,
 * anyone who can comment) and are fenced as data in the prompt — see
 * `UNTRUSTED_OPEN` below.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  // Gate on the AI being available at all — either the local CLI or an API
  // key. The previous CLI-only check 503'd every request in the cloud even
  // though the API backend can answer perfectly well there.
  if (!aiEnabled()) {
    return NextResponse.json({ error: AI_DISABLED_MESSAGE }, { status: 503 });
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
    const issue = await getIssue(issueNumber, repo);

    if (!issue.labels.some((l) => QUEUE_LABELS.includes(l))) {
      return NextResponse.json(
        { error: "That issue isn't an idea in this project's queue." },
        { status: 404 },
      );
    }

    const [comments, checkout] = await Promise.all([
      listThreadComments(issueNumber, repo),
      localCheckoutForRepo(repo.owner, repo.repo),
    ]);

    const discussion = comments.length
      ? comments.map((c) => `${defuse(c.author)}: ${defuse(c.body)}`).join("\n\n")
      : "(no discussion yet)";

    // `cwd` and `tools` are CLI-backend-only (see StructuredCallOpts) — the API
    // backend silently ignores both. Promising the model it can read real code
    // whenever a checkout merely EXISTS on disk was therefore a lie every time
    // the API backend served the call: it would happily "cite" files it never
    // opened. aiBackend() is deterministic and settled before the call, so gate
    // on it as well as on the checkout.
    const canReadCode = !!checkout && aiBackend() === "cli";

    const codeAccess = canReadCode && checkout
      ? `You CAN read this project's ACTUAL source code: it is checked out locally at ${checkout} and you have read-only tools (Read, Grep, Glob) whose working directory is that checkout. USE THEM. Before making ANY claim about how the code behaves — whether a feature exists, is wired up, is a real integration or just a stub, is even connected — grep and read the real files first, and cite the specific file paths you looked at. Never assert behaviour from the idea's wording alone: the idea text is a proposal (often written by an automated agent) and may be inaccurate, hypothetical, or describe something that isn't built yet. If the code contradicts the idea, say so plainly. If you truly can't find the relevant code after looking, say that instead of guessing.

${filesystemBoundary(checkout)}`
      : `You are NOT connected to this project's code and you have no tools. You can only reason from the idea's text and the discussion below. If a question needs real codebase access you don't have, say so plainly instead of guessing — do NOT state how the code behaves as if you had checked it, and do NOT cite file paths as though you had opened them.`;

    const transcript = messages
      .map((m) => `${m.role === "user" ? "Owner" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const system = `You are a thinking-partner for the owner of ${repo.owner}/${repo.repo}, helping them think through ONE specific improvement idea before they decide whether to approve it, send it back with feedback, or decline it. This is a private conversation — nothing you say here gets posted anywhere unless the owner explicitly chooses to include it.

${codeAccess}

${untrustedPreamble(
  "automated agents like the Scout, bots, and anyone who can comment on a GitHub issue",
)}

${UNTRUSTED_OPEN}
THE IDEA — issue #${issue.number}
Title: ${defuse(issue.title)}
Labels: ${defuse(issue.labels.join(", ")) || "none"}
Body:
${defuse(issue.body) || "(no description)"}

DISCUSSION SO FAR:
${discussion}
${UNTRUSTED_CLOSE}

THE CONVERSATION SO FAR (this IS the owner talking to you):
${transcript}

Answer the owner's questions plainly and honestly — be direct about risk, scope, feasibility, and whether this idea seems well-formed. You're here to help them decide, not to cheerlead.`;

    const result = await aiStructuredCall<{ reply: string }>({
      system,
      user: "Reply to the owner's most recent message.",
      toolName: "reply_to_owner",
      toolDescription: "Return your plain-text reply to the owner's latest message.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          reply: {
            type: "string",
            description: "Your reply to the owner, as plain text / markdown.",
          },
        },
        required: ["reply"],
      },
      timeoutMs: canReadCode ? CODE_CHAT_TIMEOUT_MS : CHAT_TIMEOUT_MS,
      cwd: canReadCode ? checkout : undefined,
      tools: canReadCode ? READONLY_TOOLS : undefined,
    });

    const reply = typeof result.reply === "string" ? result.reply.trim() : "";
    if (!reply) {
      return NextResponse.json(
        { error: "The assistant came back empty. Try asking again." },
        { status: 502 },
      );
    }
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
