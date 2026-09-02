/**
 * The real implementations of `TriageDeps`: GitHub via lib/github.ts, the LLM
 * via lib/map-ai.ts's `aiStructuredCall` (forced-tool-use structured output,
 * already wired to the CLI / Anthropic API / Bedrock backends).
 *
 * Kept in its own file so `graph.ts` stays dependency-free and testable: tests
 * inject fakes and never import this module, so they never touch the network.
 */

import { addLabel, createComment, listIssues } from "../github";
import { aiStructuredCall } from "../map-ai";

import type {
  Assessment,
  BacklogItem,
  PlannedAction,
  Recommendation,
  RepoConfig,
  TriageDeps,
} from "./types";

/** The repo this agent triages by default. */
export const DEFAULT_REPO: RepoConfig = {
  owner: "ApagPlayz",
  repo: "content-generation-platform",
};

const VALID: Recommendation[] = ["approve", "decline", "needs-info"];

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

/** Trim issue bodies so a batch of 10 doesn't blow the context window. */
function clip(text: string | null | undefined, max = 1200): string {
  const t = (text ?? "").replace(/\r\n/g, "\n").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

async function listBacklog(repo: RepoConfig, limit: number): Promise<BacklogItem[]> {
  // Ask for a full page and slice locally: listIssues() strips pull requests
  // after fetching, so a per_page equal to `limit` can come back short.
  const issues = await listIssues(undefined, { state: "open", per_page: 100, repo });
  return issues.slice(0, limit).map((i) => ({
    number: i.number,
    title: i.title ?? "(untitled)",
    body: clip(i.body),
    labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
    createdAt: i.created_at ?? "",
    url: i.html_url ?? "",
  }));
}

async function applyAction(repo: RepoConfig, action: PlannedAction): Promise<void> {
  if (action.kind === "add-label") {
    await addLabel(action.number, action.detail, repo);
    return;
  }
  if (action.kind === "comment") {
    await createComment(action.number, action.detail, repo);
  }
}

/* ------------------------------------------------------------------ */
/* LLM                                                                 */
/* ------------------------------------------------------------------ */

const ASSESS_SCHEMA = {
  type: "object",
  properties: {
    assessments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "integer", description: "The issue number being assessed." },
          recommendation: {
            type: "string",
            enum: VALID,
            description:
              "approve = worth building as-is; decline = don't build it; needs-info = under-specified.",
          },
          reason: {
            type: "string",
            description: "One sentence, max ~25 words, justifying the recommendation.",
          },
          confidence: {
            type: "number",
            description: "0 to 1. How confident you are in this recommendation.",
          },
        },
        required: ["number", "recommendation", "reason", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["assessments"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  "You triage a software project's open-issue backlog for its solo owner.",
  "For EVERY issue you are given, return exactly one assessment.",
  "approve  — clearly scoped, clearly worth the owner's time, ready to build.",
  "decline  — out of scope, duplicated, obsolete, or not worth the effort.",
  "needs-info — plausible but under-specified: you cannot tell what 'done' means.",
  "Be decisive and be honest. Do not approve vague issues to be agreeable.",
  "Keep each reason to one sentence.",
].join("\n");

function renderItems(items: BacklogItem[]): string {
  return items
    .map((i) => {
      const labels = i.labels.length ? ` [labels: ${i.labels.join(", ")}]` : "";
      return `### Issue #${i.number}: ${i.title}${labels}\n${i.body || "(no description)"}`;
    })
    .join("\n\n");
}

/** Coerce whatever came back into well-formed assessments; drop the rest. */
export function coerceAssessments(raw: unknown, items: BacklogItem[]): Assessment[] {
  const known = new Set(items.map((i) => i.number));
  const list = (raw as { assessments?: unknown })?.assessments;
  if (!Array.isArray(list)) return [];
  const out: Assessment[] = [];
  for (const entry of list) {
    const e = entry as Partial<Assessment>;
    const number = Number(e?.number);
    if (!Number.isInteger(number) || !known.has(number)) continue;
    const rec = VALID.includes(e?.recommendation as Recommendation)
      ? (e.recommendation as Recommendation)
      : "needs-info";
    const conf = Number(e?.confidence);
    out.push({
      number,
      recommendation: rec,
      reason: String(e?.reason ?? "").trim() || "No reason given.",
      confidence: Number.isFinite(conf) ? Math.min(Math.max(conf, 0), 1) : 0,
    });
  }
  return out;
}

async function assessBatch(items: BacklogItem[]): Promise<Assessment[]> {
  if (items.length === 0) return [];
  const raw = await aiStructuredCall<unknown>({
    system: SYSTEM,
    user: `Assess all ${items.length} issue(s) below.\n\n${renderItems(items)}`,
    toolName: "record_assessments",
    toolDescription: "Record one triage assessment for every issue supplied.",
    schema: ASSESS_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: 180_000,
  });
  return coerceAssessments(raw, items);
}

/* ------------------------------------------------------------------ */

/** The production dependency set. */
export function realDeps(): TriageDeps {
  return { listBacklog, assessBatch, applyAction };
}
