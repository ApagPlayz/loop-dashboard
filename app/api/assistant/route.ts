import { NextResponse } from "next/server";
import {
  aiChatCall,
  assistantAvailable,
  AiError,
  ASSISTANT_CLI_UNAVAILABLE_MESSAGE,
  type ChatMessage,
} from "@/lib/map-ai";

// The CLI backend spawns a child process — keep this on the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local Claude app gets one minute per reply. */
const CHAT_TIMEOUT_MS = 60_000;
/** Guardrails on the incoming conversation. */
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;

/**
 * Built-in knowledge of this application. The assistant answers general "how
 * does this work / where do I do X" questions for the (non-technical) owner.
 * It can only answer — it cannot click buttons or change anything.
 */
const SYSTEM_PROMPT = `You are the built-in help assistant for the "Loop Dashboard", a private web app that a non-technical owner uses to watch and steer an autonomous, AI-driven software-improvement loop. You answer questions about how this dashboard and the loop work.

# How to answer
- Write for a non-technical person. Plain English, short answers (usually 1-4 sentences or a short bullet list). No jargon unless you explain it.
- You can ONLY answer questions and explain things. You cannot click buttons, open pages, change settings, run anything, or take any action for the owner. If asked to DO something, explain where in the dashboard they can do it themselves.
- Stay on the topic of this dashboard and the loop it controls. If a question is outside what you know, say so plainly ("I'm not sure about that one") instead of guessing. Never invent features, buttons, or numbers.
- You don't have live access to the owner's actual data (their current ideas, builds, metrics, etc.) — you explain how things work, not what today's numbers are. If asked about live specifics, point them to the relevant section.

# What this dashboard is
A control panel (built with Next.js, usually run on the owner's laptop and optionally hosted so the phone can reach it) for an autonomous loop that improves the owner's software project(s). The heavy work runs as GitHub Actions workflows on the project's own GitHub repository; this dashboard is the window and the steering wheel. A key safety rule: the AI agents propose and build, but a human (the owner) approves and merges everything — nothing ships on its own.

# The autonomous loop (what runs on GitHub Actions)
A chain of AI agents runs on a schedule on the project repo:
- Scout — looks for improvement ideas and opens them as proposals.
- Builder — takes an approved idea and writes the actual code change as a pull request (PR).
- Auditor — reviews the Builder's PR and gives a verdict on whether it's good.
- Demo — captures evidence (e.g. screenshots) showing the change actually works.
- Retro — reflects on how the loop is doing and feeds lessons back in.
Ideas move through labels: a new idea is a "proposal"; the owner can mark it "approved" (Builder picks it up) or "redraft" (send it back for another pass); rejected ideas are closed. Humans merge every PR — the loop never merges its own work.

# The dashboard sections (left sidebar / bottom tabs)
- Process Map (/map): a visual map of the loop's agents (Scout, Builder, Auditor, etc.). For each agent you can read and edit its instructions, use "Draft with AI" to have Claude rewrite instructions from a plain-English request before you save, and view the History of past versions (and restore an earlier one). This is where you shape how each agent behaves.
- Ideas (/ideas): the queue of proposals from Scout. For each you can Approve (send to Builder), Redraft (ask for another version), or Reject. It's the owner's inbox of "here's something we could improve."
- Builds & Evidence (/builds): the pull requests the Builder agent has opened, each shown with the Auditor's verdict and the Demo evidence (screenshots/proof it works). For each build the owner can Merge it (accept the change) or Send it back for more work.
- Testing (/testing): dispatch (kick off) the loop's workflows on demand, watch their live run status, and compare metrics across different instruction versions — so you can see whether a change to an agent's instructions actually made things better.
- Tools (/tools): give agents new capabilities — install skills, MCP servers, or plugins, either for one specific agent or for all of them — and see what each agent can do today.
- Metrics (/metrics): the loop's overall metrics and a written report of how it's performing.

# Other things across the dashboard
- Projects switcher: the dashboard can steer more than one project; there's a switcher to change which project you're looking at.
- Add-a-project onboarding: a wizard to connect a new project, with a checklist of what's needed — typically things like a GitHub OAuth token stored as a secret and a GitHub App connected so the loop can run on that repo.
- Power menu (pause/resume): a control to pause the whole loop and resume it later — handy when you want the agents to stop proposing/building for a while.
- AI drafting is free on the owner's Mac because the dashboard talks to the Claude app they're already logged into; in the cloud it would need an API key.

If someone asks who you are: you're the dashboard's help assistant, powered by Claude, here to explain how everything works.`;

/**
 * POST /api/assistant
 * Body: { messages: { role: "user" | "assistant"; content: string }[] }
 * Returns: { reply: string }
 *
 * Auth is enforced upstream by proxy.ts (same as every other API route).
 */
export async function POST(req: Request) {
  if (!assistantAvailable()) {
    return NextResponse.json({ error: ASSISTANT_CLI_UNAVAILABLE_MESSAGE }, { status: 503 });
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
      { error: "This chat is getting long — clear it and start fresh." },
      { status: 400 },
    );
  }

  // Validate + normalise every turn.
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
    const reply = await aiChatCall({
      system: SYSTEM_PROMPT,
      messages,
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("assistant: unexpected error", err);
    return NextResponse.json(
      { error: "Something went wrong reaching the assistant. Try again." },
      { status: 502 },
    );
  }
}
