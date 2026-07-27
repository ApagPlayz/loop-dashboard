import { NextResponse } from "next/server";
import { aiStructuredCall, AiError } from "@/lib/map-ai";
import { resolveProject, ProjectError } from "@/lib/projects";
import { localCheckoutForRepo } from "@/lib/local-folders";
import { loadCatalog, shortlistForText, type CatalogEntry, type ToolType } from "@/lib/tool-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// This route stays synchronous — one turn, one answer — so the platform's
// limit has to cover the AI budget below plus the catalog/checkout lookups.
// Without this it was killed mid-turn in the cloud at the default timeout.
export const maxDuration = 180;

/** Longer budget when the assistant is actually reading code (multi-turn). */
const CODE_CHAT_TIMEOUT_MS = 150_000;
/** Read-only tools handed to the assistant when a local checkout exists. */
const READONLY_TOOLS = ["Read", "Grep", "Glob"];
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;
/** Cap the shortlist rendered into the prompt so it stays cheap. */
const SHORTLIST_LIMIT = 25;

type ChatMessage = { role: "user" | "assistant"; content: string };

type SuggestedTool = { id: string; name: string; type: ToolType; url: string; reason: string };

type DraftResult = {
  reply: string;
  title: string;
  body: string;
  suggestedTools: { id: string; reason: string }[];
};

/**
 * POST /api/ideas/custom/chat
 * Body: {
 *   project?: string,
 *   title?: string,
 *   body?: string,
 *   messages: { role: "user" | "assistant"; content: string }[],
 *   attachedToolIds?: string[]
 * }
 * Returns: { reply, title, body, suggestedTools: [{ id, name, type, url, reason }] }
 *
 * A continuous, code-aware drafting chat for the owner's CUSTOM idea, BEFORE it
 * is filed as a GitHub `proposal`. Each turn it (a) refines the draft
 * title/body, (b) reads the target project's real code when a local checkout
 * exists, and (c) suggests relevant Claude integrations from the catalog. This
 * is private — nothing is posted anywhere until the owner files the idea.
 */
export async function POST(req: Request) {
  let body: {
    project?: unknown;
    title?: unknown;
    body?: unknown;
    messages?: unknown;
    attachedToolIds?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const draftTitle = typeof body.title === "string" ? body.title : "";
  const draftBody = typeof body.body === "string" ? body.body : "";
  const project = typeof body.project === "string" ? body.project : undefined;
  const attachedToolIds = Array.isArray(body.attachedToolIds)
    ? body.attachedToolIds.filter((id): id is string => typeof id === "string")
    : [];

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
    const { repo } = await resolveProject(project);
    const [checkout, catalog] = await Promise.all([
      localCheckoutForRepo(repo.owner, repo.repo),
      loadCatalog(),
    ]);
    const byId = new Map(catalog.entries.map((e) => [e.id, e]));

    const lastUserMessage = messages[messages.length - 1].content;
    const shortlist = shortlistForText(`${draftTitle}\n${draftBody}\n${lastUserMessage}`, {
      limit: SHORTLIST_LIMIT,
      alwaysIncludeIds: attachedToolIds,
    });

    const shortlistLines = shortlist
      .map((e) => {
        const hint = (e.goodFor && e.goodFor[0]) || e.description || "";
        const short = hint.length > 120 ? hint.slice(0, 117).trimEnd() + "…" : hint;
        return `${e.id} | ${e.name} | ${e.type.toUpperCase()} | ${short}`;
      })
      .join("\n");
    const shortlistBlock = shortlistLines || "(no candidate integrations matched)";

    const attachedBlock = attachedToolIds.length
      ? attachedToolIds
          .map((id) => {
            const e = byId.get(id);
            return e ? `${e.id} (${e.name})` : id;
          })
          .join(", ")
      : "(none attached yet)";

    const transcript = messages
      .map((m) => `${m.role === "user" ? "Owner" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const codeAccess = checkout
      ? `You CAN read this project's ACTUAL source code: it is checked out locally and you have read-only tools (Read, Grep, Glob) rooted at its repository. USE THEM. Before making ANY claim about how the code behaves — whether a feature exists, is wired up, is a real integration or just a stub, is even connected — grep and read the real files first, and cite the specific file paths you looked at. Never assert behaviour from wording alone. Grounding the idea in the real code is what makes it useful: if the code already does what the idea proposes, say so; if it contradicts an assumption, say so plainly.`
      : `You are NOT connected to this project's code on this machine (its local checkout isn't available here), and you have no tools. You can only reason from the draft and the conversation. If shaping the idea would need real codebase access you don't have, say so plainly instead of guessing — do NOT state how the code behaves as if you had checked it.`;

    const system = `You are co-drafting ONE custom improvement idea for ${repo.owner}/${repo.repo} together with the owner. When they're happy, this draft gets filed as a GitHub \`proposal\` issue that enters the normal triage queue. This is a private drafting conversation — nothing is posted anywhere until the owner files it.

${codeAccess}

THE CURRENT DRAFT
Title: ${draftTitle || "(empty)"}
Body:
${draftBody || "(empty)"}

THE CONVERSATION SO FAR:
${transcript}

CANDIDATE INTEGRATIONS (Claude MCP servers, skills, and plugins from the owner's catalog — one per line as \`id | name | TYPE | what it's good for\`). You may ONLY suggest integrations from this list, referenced by their exact id:
${shortlistBlock}

INTEGRATIONS THE OWNER HAS ALREADY ATTACHED: ${attachedBlock}

YOUR JOB, each turn:
1. Refine the draft's title and body in response to the owner's LATEST message. ALWAYS return the FULL current draft (the complete updated title and complete updated body markdown) — never a diff or a fragment. If the latest turn doesn't change the draft, return it unchanged.
2. Write a short conversational reply to the owner explaining what you changed or asking a clarifying question.
3. Suggest integrations ONLY from the candidate list above, ONLY by their exact id, and ONLY when one is genuinely useful for building or running this specific idea. Give a one-line reason for each. Be PROACTIVE when the fit is obvious: if the idea clearly needs a capability a candidate provides (e.g. web scraping/crawling, browser automation, a database, payments, a specific API) and the project doesn't already have it, name the single best-fit integration on your own — the owner is relying on you to surface these, not just answer when asked. But stay disciplined: suggest the ONE or TWO that genuinely fit, never pad the list, and suggesting zero is correct when nothing clearly fits. Do not re-suggest ones the owner already attached unless they're clearly central.

Keep the title concise. Write the body as clear markdown a Builder agent could act on.`;

    const user = `Reply to the owner's most recent message and return the updated draft as JSON.`;

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        reply: { type: "string", description: "Your conversational reply to the owner." },
        title: { type: "string", description: "The FULL updated draft title." },
        body: { type: "string", description: "The FULL updated draft body, as markdown." },
        suggestedTools: {
          type: "array",
          description: "Integrations to suggest, from the candidate list only.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", description: "The exact catalog id from the candidate list." },
              reason: { type: "string", description: "One-line reason this integration helps." },
            },
            required: ["id", "reason"],
          },
        },
      },
      required: ["reply", "title", "body", "suggestedTools"],
    };

    const result = await aiStructuredCall<DraftResult>({
      system,
      user,
      toolName: "draft_custom_idea",
      toolDescription:
        "Return the conversational reply, the full updated draft title and body, and any suggested integrations by catalog id.",
      schema,
      timeoutMs: CODE_CHAT_TIMEOUT_MS,
      cwd: checkout ?? undefined,
      tools: checkout ? READONLY_TOOLS : undefined,
    });

    // Map suggested ids back through the catalog so name/type/url are
    // authoritative — never trust the model's copy. Drop unknown ids and dedupe.
    const seen = new Set<string>();
    const suggestedTools: SuggestedTool[] = [];
    for (const s of Array.isArray(result.suggestedTools) ? result.suggestedTools : []) {
      const id = typeof s?.id === "string" ? s.id : "";
      const entry: CatalogEntry | undefined = byId.get(id);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      suggestedTools.push({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        url: entry.url,
        reason: typeof s?.reason === "string" ? s.reason : "",
      });
    }

    return NextResponse.json({
      reply: typeof result.reply === "string" ? result.reply : "",
      title: typeof result.title === "string" ? result.title : draftTitle,
      body: typeof result.body === "string" ? result.body : draftBody,
      suggestedTools,
    });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("custom idea chat: failed", err);
    return NextResponse.json({ error: "Couldn't reach Claude. Try again." }, { status: 502 });
  }
}
