import { NextResponse } from "next/server";
import { aiStructuredCall, aiEnabled, AiError, AI_DISABLED_MESSAGE } from "@/lib/map-ai";
import { startJob } from "@/lib/map-ai-jobs";
import { resolveProjectFromUrl, findProjectAgent, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
// The CLI backend spawns a child process — keep this on the Node runtime.
export const runtime = "nodejs";

/** Single-agent drafts get 5 minutes (background job). */
const DRAFT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * POST /api/map/agent/[id]/draft
 * Start a background job that revises this agent's instructions.
 *
 * Body: {
 *   request: string,           — what the owner wants changed
 *   mode: "prompt" | "raw",    — friendly instructions text vs. full YAML
 *   current: string,           — the text currently in the editor
 * }
 * Returns: { jobId } immediately — poll GET /api/map/ai-job/[jobId].
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let project;
  try {
    ({ project } = await resolveProjectFromUrl(req.url));
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
  const meta = await findProjectAgent(project, id);
  if (!meta) return NextResponse.json({ error: "Unknown agent." }, { status: 404 });

  let body: { request?: string; mode?: string; current?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const request = (body.request ?? "").trim();
  const current = body.current ?? "";
  const mode = body.mode === "raw" ? "raw" : "prompt";
  if (!request) {
    return NextResponse.json({ error: "Describe what you want changed." }, { status: 400 });
  }
  if (!current.trim()) {
    return NextResponse.json({ error: "There's nothing to revise yet." }, { status: 400 });
  }
  if (!aiEnabled()) {
    return NextResponse.json({ error: AI_DISABLED_MESSAGE }, { status: 503 });
  }

  const system =
    mode === "prompt"
      ? `You revise the instructions of an autonomous CI agent called "${meta.label}" (${meta.tagline}) that is part of a GitHub Actions loop on a software project. The text you are given is the agent's prompt, extracted from a workflow YAML block scalar — it is plain instruction text, NOT YAML.

Rules:
- Apply ONLY the change the owner asks for. Keep everything else word-for-word identical — do not rephrase, reformat, re-wrap, or "improve" untouched parts.
- Preserve the existing structure, numbering, separators, and any \${{ ... }} GitHub Actions expressions exactly.
- Return the COMPLETE revised instructions text via the tool.`
      : `You revise a GitHub Actions workflow file for an autonomous CI agent called "${meta.label}" (${meta.tagline}). The text you are given is the FULL raw YAML of the workflow.

Rules:
- Apply ONLY the change the owner asks for. Every byte outside that change must stay identical — comments, blank lines, indentation, quoting, ordering.
- The result must remain valid GitHub Actions YAML.
- Preserve any \${{ ... }} expressions exactly.
- Return the COMPLETE revised file via the tool.`;

  const user = `Current ${mode === "prompt" ? "instructions" : "workflow file"}:
<current>
${current}
</current>

The owner's request: ${request}`;

  // Kick the drafting off in the background and hand back a job id at once.
  const job = startJob("draft", { request, agentId: id, mode, project: project.key }, async () => {
    const result = await aiStructuredCall<{ revised: string }>({
      system,
      user,
      toolName: "submit_revision",
      toolDescription: "Submit the complete revised text.",
      timeoutMs: DRAFT_TIMEOUT_MS,
      schema: {
        type: "object",
        properties: {
          revised: {
            type: "string",
            description: "The complete revised text, in full.",
          },
        },
        required: ["revised"],
        additionalProperties: false,
      },
    });
    const draft = result.revised ?? "";
    if (!draft.trim()) {
      throw new AiError("The AI returned an empty draft. Try again.");
    }
    return { draft };
  });

  return NextResponse.json({ jobId: job.id });
}
