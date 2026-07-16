import { NextResponse } from "next/server";
import { aiStructuredCall, aiEnabled, AiError, AI_DISABLED_MESSAGE } from "@/lib/map-ai";
import { getDigest } from "@/lib/reporter";

export const dynamic = "force-dynamic";
// The CLI backend spawns a child process — keep this on the Node runtime.
export const runtime = "nodejs";

const SUMMARY_TIMEOUT_MS = 90 * 1000;

/**
 * POST /api/reporter/summarize
 * Ask the existing AI backend (local `claude` CLI, else Anthropic API) for a
 * short plain-English "here's what happened lately" paragraph built from the
 * current digest. Runs synchronously — the digest is small, so one call is
 * enough and there's nothing to poll.
 */
export async function POST() {
  if (!aiEnabled()) {
    return NextResponse.json({ error: AI_DISABLED_MESSAGE }, { status: 503 });
  }

  let digest;
  try {
    digest = await getDigest();
  } catch {
    return NextResponse.json({ error: "Couldn't read the digest to summarize." }, { status: 502 });
  }

  // Feed the model the most recent items (title, source, category, date).
  const lines = digest.items
    .slice(0, 40)
    .map((it) => {
      const when = it.date ? new Date(it.date).toISOString().slice(0, 10) : "just now";
      return `- [${it.category}] ${it.title} (${it.source}, ${when})`;
    })
    .join("\n");

  const system = `You brief a non-technical product owner on what's new in the Claude Code / AI-agent world. Write in plain English, warm and concrete — no jargon, no hype. You are given a list of recent news items (Claude Code releases, new MCP servers, skills/plugins, official Anthropic news, and community chatter).`;

  const user = `Here are the latest items in the news digest:

${lines}

Write a short "what's new lately" briefing (3-5 sentences, one paragraph). Lead with the most important developments (new Claude Code releases and official announcements), then note any interesting new MCP servers, skills, or plugins, and finish with the general community mood if relevant. Do not list every item — synthesize. Plain English only.`;

  try {
    const result = await aiStructuredCall<{ summary: string }>({
      system,
      user,
      toolName: "submit_summary",
      toolDescription: "Submit the plain-English briefing paragraph.",
      timeoutMs: SUMMARY_TIMEOUT_MS,
      schema: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "A 3-5 sentence plain-English briefing of what's new lately.",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    });
    const summary = (result.summary ?? "").trim();
    if (!summary) {
      return NextResponse.json({ error: "The AI came back empty. Try again." }, { status: 502 });
    }
    return NextResponse.json({ summary, generatedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    }
    console.error("reporter: summarize failed", e);
    return NextResponse.json({ error: "Couldn't summarize right now. Try again." }, { status: 502 });
  }
}
