import { NextResponse } from "next/server";
import { aiStructuredCall, aiEnabled, AI_DISABLED_MESSAGE, AiError } from "@/lib/map-ai";
import { startJob } from "@/lib/map-ai-jobs";
import { getDigest } from "@/lib/reporter";

export const dynamic = "force-dynamic";
// The CLI backend spawns a child process — keep this on the Node runtime.
export const runtime = "nodejs";

const SUMMARY_TIMEOUT_MS = 90 * 1000;

/**
 * POST /api/reporter/summarize
 * Ask the existing AI backend (local `claude` CLI, else Anthropic API) for a
 * short plain-English "here's what happened lately" paragraph built from the
 * current digest. Runs as a background job — returns { jobId } immediately so
 * the owner can leave the page and come back; the client polls
 * GET /api/map/ai-job/[id] and restores via /api/map/ai-job/latest.
 */
export async function POST() {
  if (!aiEnabled()) {
    return NextResponse.json({ error: AI_DISABLED_MESSAGE }, { status: 503 });
  }

  const job = startJob("reporter-summary", {}, async () => {
    let digest;
    try {
      digest = await getDigest();
    } catch {
      throw new AiError("Couldn't read the digest to summarize.", 502);
    }

    // Feed the model the most recent items (title, source, category, date).
    // When an item has a distilled community insight (real discussion
    // sentiment, not guesswork), append it so the "community mood" line in
    // the briefing is grounded in what people actually said.
    const lines = digest.items
      .slice(0, 40)
      .map((it) => {
        const when = it.date ? new Date(it.date).toISOString().slice(0, 10) : "just now";
        const base = `- [${it.category}] ${it.title} (${it.source}, ${when})`;
        return it.insight ? `${base} — people say: ${it.insight}` : base;
      })
      .join("\n");

    const system = `You brief a non-technical product owner on what's new in the Claude Code / AI-agent world. Write in plain English, warm and concrete — no jargon, no hype. You are given a list of recent news items (Claude Code releases, new MCP servers, skills/plugins, official Anthropic news, and community chatter).`;

    const user = `Here are the latest items in the news digest:

${lines}

Write a short "what's new lately" briefing (3-5 sentences, one paragraph). Lead with the most important developments (new Claude Code releases and official announcements), then note any interesting new MCP servers, skills, or plugins, and finish with the general community mood if relevant. Where items are annotated with "people say:", that's real discussion sentiment pulled from HN/Reddit threads — ground your community-mood sentence in those, don't guess from titles alone. Do not list every item — synthesize. Plain English only.`;

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
      throw new AiError("The AI came back empty. Try again.", 502);
    }
    return { summary, generatedAt: new Date().toISOString() };
  });

  return NextResponse.json({ jobId: job.id });
}
