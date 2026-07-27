import { NextResponse } from "next/server";
import { createIssue } from "@/lib/github";
import { resolveProject, ProjectError } from "@/lib/projects";
import { loadCatalog, type ToolType } from "@/lib/tool-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A Claude integration the owner chose to attach to this idea. */
type AttachedTool = { id?: string; name: string; type: ToolType; url: string };

type Body = {
  project?: string;
  title?: string;
  body?: string;
  viaClarify?: boolean;
  /** Integrations the owner attached (full records, or resolved from ids). */
  attachedTools?: AttachedTool[];
  /** Catalog ids to resolve into attached-tool records via the catalog. */
  attachedToolIds?: string[];
};

/** Turn free text into a short title: first sentence, trimmed to 80 chars. */
function deriveTitle(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const source = firstLine || text.trim();
  // Cut at the first sentence end if there is one early enough.
  const sentenceMatch = source.match(/^(.+?[.!?])(\s|$)/);
  let title = sentenceMatch ? sentenceMatch[1] : source;
  title = title.replace(/\s+/g, " ").trim();
  if (title.length > 80) title = title.slice(0, 79).trimEnd() + "…";
  return title || "Custom idea";
}

/**
 * Resolve the owner's attached integrations into clean records, robustly
 * accepting either full `attachedTools` objects or bare `attachedToolIds`
 * (looked up in the catalog). Deduped by id/url; malformed entries dropped.
 */
async function resolveAttachedTools(body: Body): Promise<AttachedTool[]> {
  const out: AttachedTool[] = [];
  const seen = new Set<string>();

  const push = (t: AttachedTool | undefined | null) => {
    if (!t || typeof t.name !== "string" || typeof t.url !== "string") return;
    const key = (t.id || t.url).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  const rawTools = Array.isArray(body.attachedTools) ? body.attachedTools : [];
  const ids = Array.isArray(body.attachedToolIds)
    ? body.attachedToolIds.filter((id): id is string => typeof id === "string")
    : [];

  // Only touch the catalog if we actually need to resolve ids or backfill.
  const needCatalog = ids.length > 0 || rawTools.some((t) => t && (!t.name || !t.url) && t.id);
  let byId = new Map<string, { id: string; name: string; type: ToolType; url: string }>();
  if (needCatalog) {
    try {
      const catalog = await loadCatalog();
      byId = new Map(catalog.entries.map((e) => [e.id, e]));
    } catch {
      /* catalog unavailable — fall back to whatever the body already carried */
    }
  }

  for (const t of rawTools) {
    if (!t || typeof t !== "object") continue;
    if ((!t.name || !t.url) && t.id) {
      const e = byId.get(t.id);
      if (e) {
        push({ id: e.id, name: e.name, type: e.type, url: e.url });
        continue;
      }
    }
    push(t);
  }

  for (const id of ids) {
    const e = byId.get(id);
    if (e) push({ id: e.id, name: e.name, type: e.type, url: e.url });
  }

  return out;
}

/**
 * Render the attached integrations as a markdown section for the issue body.
 *
 * Deliberately honest: nothing in the loop installs or wires these up. The old
 * wording promised "for the Builder/tool-installer to wire up", which no
 * workflow performs — so the Builder read a promise it could not keep and the
 * owner expected a step that never ran. They are context, nothing more.
 *
 * The heading is `## Context for the Builder` because the Builder reads the
 * whole issue body (and its comments) when it plans a build; a section it can
 * recognise is more use to it than one addressed to a step that doesn't exist.
 */
function renderAttachedTools(tools: AttachedTool[]): string {
  const lines = tools.map((t) => `- **${t.name}** (${t.type}) — ${t.url}`);
  return [
    "",
    "",
    "## Context for the Builder",
    "",
    "The owner attached these Claude integrations as **context** for this idea.",
    "They are NOT installed or configured automatically — nothing in the loop",
    "wires them up. Treat them as a pointer to the capability the owner has in",
    "mind, and only use one if it is already available in this repo's",
    "environment. If the work genuinely needs one that isn't set up, say so in",
    "the pull request instead of assuming it exists.",
    "",
    ...lines,
  ].join("\n");
}

/**
 * POST /api/ideas/custom
 *
 * File the owner's custom idea as a `proposal` issue on the chosen project so
 * it enters the normal triage queue. Body: { project, title?, body, viaClarify }.
 * Returns { number, htmlUrl }.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const ideaBody = (body.body ?? "").trim();
  if (!ideaBody) {
    return NextResponse.json(
      { error: "Write your idea before submitting." },
      { status: 400 },
    );
  }

  let resolved;
  try {
    resolved = await resolveProject(body.project);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
  const { repo } = resolved;

  const title = (body.title ?? "").trim() || deriveTitle(ideaBody);

  const provenance = body.viaClarify
    ? "> Custom idea filed by the owner from the dashboard (refined with clarifying questions)."
    : "> Custom idea filed by the owner from the dashboard.";

  const attachedTools = await resolveAttachedTools(body);
  const toolsSection = attachedTools.length ? renderAttachedTools(attachedTools) : "";
  const issueBody = `${provenance}\n\n${ideaBody}${toolsSection}`;

  try {
    // Assign the repo owner, the same way the Scout files its issues with
    // `--assignee ${{ github.repository_owner }}`. Without it the owner's own
    // ideas were the only ones that never reached their GitHub inbox.
    const issue = await createIssue(title, issueBody, ["proposal"], repo, {
      assignees: [repo.owner],
    });
    return NextResponse.json({ number: issue.number, htmlUrl: issue.html_url });
  } catch (err) {
    console.error("ideas/custom: create failed", err);
    return NextResponse.json(
      { error: "Couldn't file the idea on GitHub. Try again." },
      { status: 502 },
    );
  }
}
