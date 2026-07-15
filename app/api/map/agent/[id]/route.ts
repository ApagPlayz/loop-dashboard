import { NextResponse } from "next/server";
import { getFileContent, getWorkflowRuns } from "@/lib/github";
import { getAgent, TARGET_REPO, FALLBACK_REF } from "@/lib/map-agents";
import { parseCapabilities } from "@/lib/map-capabilities";
import { extractPrompt } from "@/lib/map-yaml";
import { aiEnabled } from "@/lib/map-ai";
import type { AgentDetail, RunSummary } from "@/lib/map-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/map/agent/[id]
 * Everything the drawer needs in one shot: description + triggers (from meta),
 * last 5 runs, capabilities, and the workflow YAML with a friendly prompt
 * extracted when possible.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = getAgent(id);
  if (!meta) {
    return NextResponse.json({ error: "Unknown agent." }, { status: 404 });
  }

  const path = `.github/workflows/${meta.file}`;

  try {
    // Prefer main; fall back to the PR #44 branch for workflows not merged yet.
    let ref = meta.onMain ? "main" : FALLBACK_REF;
    let rawYaml = await getFileContent(path, ref);
    if (rawYaml === null && meta.onMain) {
      // Not on main after all — try the fallback branch so we can at least show it.
      const fromBranch = await getFileContent(path, FALLBACK_REF);
      if (fromBranch !== null) {
        rawYaml = fromBranch;
        ref = FALLBACK_REF;
      }
    }

    const mcpJson = await getFileContent(".mcp.json", "main").catch(() => null);

    let runs: RunSummary[] = [];
    try {
      const raw = await getWorkflowRuns({ workflowId: meta.file, per_page: 5 });
      runs = raw.map(toRunSummary);
    } catch {
      // Workflow may not be registered yet (PR #44) — leave runs empty.
      runs = [];
    }

    const extraction = rawYaml ? extractPrompt(rawYaml) : ({ ok: false, reason: "File not found." } as const);
    const capabilities = parseCapabilities(rawYaml, mcpJson);

    // Editing writes to main, so only files already on main are editable here.
    const editable = ref === "main" && rawYaml !== null;

    const detail: AgentDetail = {
      meta,
      runs,
      capabilities,
      ref,
      fileFound: rawYaml !== null,
      prompt: extraction.ok ? extraction.prompt : null,
      rawYaml,
      promptExtractable: extraction.ok,
      extractionNote: extraction.ok ? undefined : extraction.reason,
      editable,
      historyUrl: `https://github.com/${TARGET_REPO.owner}/${TARGET_REPO.repo}/commits/${ref}/${path}`,
      aiEnabled: aiEnabled(),
    };
    return NextResponse.json(detail);
  } catch (err) {
    console.error(`agent[${id}]: fatal`, err);
    return NextResponse.json(
      { error: "Couldn't load this agent from GitHub. Try again in a moment." },
      { status: 502 },
    );
  }
}

type RawRun = {
  id: number;
  status: string | null;
  conclusion: string | null;
  created_at?: string | null;
  run_started_at?: string | null;
  updated_at?: string | null;
  html_url: string;
};

function toRunSummary(r: RawRun): RunSummary {
  const start = r.run_started_at ?? r.created_at ?? null;
  const end = r.updated_at ?? null;
  let durationSec: number | null = null;
  if (start && end) {
    const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
    durationSec = d >= 0 ? d : null;
  }
  return {
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
    durationSec,
    url: r.html_url,
  };
}
