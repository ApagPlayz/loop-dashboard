import { NextResponse } from "next/server";
import { aiStructuredCall, aiEnabled, AiError, AI_DISABLED_MESSAGE } from "@/lib/map-ai";
import { startJob } from "@/lib/map-ai-jobs";
import { resolveProject, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
// The CLI backend spawns a child process — keep this on the Node runtime.
export const runtime = "nodejs";

/** Custom-idea AI calls get 5 minutes (background job). */
const AI_TIMEOUT_MS = 5 * 60 * 1000;

type Body = {
  mode?: string;
  project?: string;
  prompt?: string;
  questions?: unknown;
  answers?: unknown;
};

/**
 * POST /api/ideas/custom/ai
 *
 * Two phases of turning the owner's rough idea into a polished brief, both run
 * as background jobs (poll GET /api/map/ai-job/[jobId]):
 *
 *   mode: "clarify" — Claude reads the rough prompt and returns 3–5 plain
 *     follow-up questions. Body: { mode, project, prompt }.
 *     Result: { questions: string[] }.
 *
 *   mode: "compose" — Claude turns the prompt + the owner's answers into a
 *     structured idea brief. Body: { mode, project, prompt, questions, answers }.
 *     Result: { title, body }.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const mode = body.mode === "compose" ? "compose" : body.mode === "clarify" ? "clarify" : null;
  if (!mode) {
    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json(
      { error: "Write your idea first, then Claude can help." },
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
  const { project } = resolved;

  if (!aiEnabled()) {
    return NextResponse.json({ error: AI_DISABLED_MESSAGE }, { status: 503 });
  }

  if (mode === "clarify") {
    const system = `You are helping a NON-TECHNICAL owner sharpen a rough idea or research request before it is handed to an autonomous coding loop that works on a software project called "${project.label}" (GitHub repo ${project.owner}/${project.repo}).

Your job: read the owner's rough idea and ask 3 to 5 short follow-up questions whose answers would genuinely change what gets researched or built. Skip anything you can reasonably assume. Do NOT ask for information the owner already gave you.

Rules:
- Plain English, no jargon, no code terms. The owner is not a developer.
- Each question stands on its own and is answerable in a sentence or two.
- Prefer questions about scope, the goal, who it's for, and what "done" looks like.`;

    const user = `The owner's rough idea for "${project.label}":
<idea>
${prompt}
</idea>

Return 3 to 5 clarifying questions.`;

    const job = startJob(
      "custom-idea",
      { mode, project: project.key, request: prompt },
      async () => {
        const result = await aiStructuredCall<{ questions: string[] }>({
          system,
          user,
          toolName: "submit_questions",
          toolDescription: "Submit 3 to 5 plain-English clarifying questions.",
          timeoutMs: AI_TIMEOUT_MS,
          schema: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: { type: "string" },
                description: "3 to 5 short, plain-English follow-up questions.",
              },
            },
            required: ["questions"],
            additionalProperties: false,
          },
        });
        const questions = Array.isArray(result.questions)
          ? result.questions.filter((q) => typeof q === "string" && q.trim()).map((q) => q.trim())
          : [];
        if (questions.length === 0) {
          throw new AiError("Claude didn't come back with any questions. Try again.");
        }
        return { questions };
      },
    );
    return NextResponse.json({ jobId: job.id });
  }

  // mode === "compose"
  const questions = Array.isArray(body.questions)
    ? (body.questions as unknown[]).map((q) => String(q ?? ""))
    : [];
  const answers = Array.isArray(body.answers)
    ? (body.answers as unknown[]).map((a) => String(a ?? ""))
    : [];

  const qa = questions
    .map((q, i) => {
      const a = (answers[i] ?? "").trim();
      return `Q: ${q}\nA: ${a ? a : "(skipped)"}`;
    })
    .join("\n\n");

  const system = `You are turning a NON-TECHNICAL owner's rough idea plus their answers to your follow-up questions into a clear, well-structured idea brief for an autonomous coding loop that works on a software project called "${project.label}" (GitHub repo ${project.owner}/${project.repo}).

Write the brief so the loop's redraft and builder agents can act on it without further clarification.

The brief body must be Markdown with these sections:
- **Goal** — one or two sentences on what the owner wants.
- **Context** — the relevant details, incorporating the owner's answers.
- **What to research or build** — the concrete work, in plain steps.
- **What "done" looks like** — how we'll know it's finished.

Rules:
- Plain English, no jargon. Base it strictly on what the owner said; don't invent scope they didn't ask for.
- The title is an imperative, 80 characters or fewer.`;

  const user = `The owner's original idea for "${project.label}":
<idea>
${prompt}
</idea>

${qa ? `Their answers to your follow-up questions:\n<answers>\n${qa}\n</answers>\n` : ""}
Write the polished idea brief.`;

  const job = startJob(
    "custom-idea",
    { mode, project: project.key, request: prompt },
    async () => {
      const result = await aiStructuredCall<{ title: string; body: string }>({
        system,
        user,
        toolName: "submit_idea",
        toolDescription: "Submit the polished idea title and Markdown body.",
        timeoutMs: AI_TIMEOUT_MS,
        schema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Imperative title, 80 characters or fewer.",
            },
            body: {
              type: "string",
              description: "The idea brief in Markdown (goal, context, what to build, done).",
            },
          },
          required: ["title", "body"],
          additionalProperties: false,
        },
      });
      const title = (result.title ?? "").trim();
      const briefBody = (result.body ?? "").trim();
      if (!title || !briefBody) {
        throw new AiError("Claude returned an empty draft. Try again.");
      }
      return { title, body: briefBody };
    },
  );
  return NextResponse.json({ jobId: job.id });
}
