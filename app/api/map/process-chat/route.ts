import { NextResponse } from "next/server";
import { aiEnabled, AI_DISABLED_MESSAGE, type ChatMessage } from "@/lib/map-ai";
import { startJob } from "@/lib/map-ai-jobs";
import { runProcessChat, resolveChatTargetLabel } from "@/lib/process-chat";
import { ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
// The CLI backend spawns a child process — keep this on the Node runtime.
export const runtime = "nodejs";

/** Keep the transcript sane: the model gets the newest turns only. */
const MAX_TURNS = 40;
const MAX_MESSAGE_CHARS = 8000;

/**
 * POST /api/map/process-chat
 * One turn of the conversational process editor, run as a background job
 * (AI is slow — poll GET /api/map/ai-job/[jobId]).
 *
 * Body: { target: "template" | <project key>, messages: [{ role, content }] }
 * Returns: { jobId } immediately.
 */
export async function POST(req: Request) {
  let body: { target?: string; messages?: { role?: string; content?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const target = (body.target ?? "").trim();
  if (!target) {
    return NextResponse.json({ error: "Missing target." }, { status: 400 });
  }
  try {
    await resolveChatTargetLabel(target); // 404s unknown projects up front
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }

  const messages: ChatMessage[] = [];
  for (const m of body.messages ?? []) {
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return NextResponse.json({ error: "Bad conversation format." }, { status: 400 });
    }
    const content = m.content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (content) messages.push({ role: m.role, content });
  }
  const trimmed = messages.slice(-MAX_TURNS);
  const last = trimmed[trimmed.length - 1];
  if (!last || last.role !== "user") {
    return NextResponse.json({ error: "Say what you'd like changed first." }, { status: 400 });
  }
  if (!aiEnabled()) {
    return NextResponse.json({ error: AI_DISABLED_MESSAGE }, { status: 503 });
  }

  // `project` doubles as the target key ("template" or a project key) so the
  // existing latest-job restore endpoint scopes chats per target.
  const job = startJob("process-chat", { request: last.content, project: target }, () =>
    runProcessChat(target, trimmed),
  );
  return NextResponse.json({ jobId: job.id });
}
