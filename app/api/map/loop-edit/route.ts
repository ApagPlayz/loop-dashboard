import { NextResponse } from "next/server";
import { snapshotWorkflows } from "@/lib/map-history";
import { aiStructuredCall, aiEnabled, AiError, AI_DISABLED_MESSAGE } from "@/lib/map-ai";
import type { FileChange } from "@/lib/map-types";

export const dynamic = "force-dynamic";

const LOOP_DESCRIPTION = `The workflows form an autonomous improvement loop on a software product's GitHub repo:
- claude-scout.yml (Scout): hourly; researches and files 'proposal' issues. Never writes code.
- claude-redraft.yml (Redraft): rewrites a proposal when the owner adds the 'redraft' label with feedback.
- claude-builder.yml (Builder): picks the best approved/proposal issue and opens ONE pull request from a claude/ branch.
- claude-audit.yml (Auditor): on every PR; five adversarial reviewers post a SHIP / FIX FIRST / DO NOT MERGE verdict.
- claude-demo.yml (Demo): captures screenshot/video evidence on claude/ PRs and posts it as a comment.
- claude-retro.yml (Retro): weekly; proposes edits to LEARNINGS.md and the other agents' prompts.
- loop-metrics.yml (Metrics): plain daily reporting job, no AI.
- claude-mention.yml (@mention): '@claude' comments wake an agent — the owner's phone remote control.
- claude-tool-install.yml (Tool installer): repository_dispatch 'tool-install' wires new tools into the agents.
- repo-tests.yml: ordinary CI (install, lint, test, build), no AI.

The owner is non-technical and reviews everything from a phone.`;

/**
 * POST /api/map/loop-edit
 * Draft a change to the overall loop from a plain-English request.
 *
 * Body: { request: string }
 * Returns: { summary: string, changes: FileChange[] }  (changes may be empty)
 */
export async function POST(req: Request) {
  let body: { request?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const request = (body.request ?? "").trim();
  if (!request) {
    return NextResponse.json({ error: "Describe what you want changed." }, { status: 400 });
  }
  if (!aiEnabled()) {
    return NextResponse.json({ error: AI_DISABLED_MESSAGE }, { status: 503 });
  }

  let current: Map<string, string>;
  try {
    current = await snapshotWorkflows("main");
  } catch (err) {
    console.error("loop-edit: snapshot failed", err);
    return NextResponse.json(
      { error: "Couldn't load the current workflows from GitHub. Try again." },
      { status: 502 },
    );
  }

  const filesBlock = [...current.entries()]
    .map(([name, yaml]) => `<file name="${name}">\n${yaml}\n</file>`)
    .join("\n\n");

  const system = `You are the maintenance engineer for an autonomous agent loop built on GitHub Actions. ${LOOP_DESCRIPTION}

You will be given the CURRENT content of every workflow file and a plain-English request from the owner. Draft the change.

Rules:
- You may ONLY modify the existing files listed. You must NOT invent new files. If the request truly needs a brand-new workflow file, do not create it — explain in the summary that the owner should ask Claude in the chat session to add new agents (the dashboard's map is hardcoded to the current set), and only include whatever parts of the request CAN be done by editing existing files.
- For each file you change, return its COMPLETE new content. Change only what the request requires; keep every other byte identical — comments, blank lines, indentation, quoting.
- Keep every file valid GitHub Actions YAML and preserve \${{ ... }} expressions exactly.
- Cron schedules use POSIX cron syntax in UTC.
- The summary must be plain English for a non-technical owner: what will change, in which agents, and why. Keep it short.
- If the request is unclear or risky, say so in the summary and make only the safe part of the change (or no change).`;

  const user = `Current workflow files:

${filesBlock}

The owner's request: ${request}`;

  try {
    const result = await aiStructuredCall<{
      summary: string;
      changes?: { file: string; newContent: string }[];
    }>({
      system,
      user,
      toolName: "propose_loop_change",
      toolDescription:
        "Propose the workflow changes: a plain-English summary and the complete new content of each changed file.",
      schema: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "Plain-English explanation of what will change and why, for a non-technical owner.",
          },
          changes: {
            type: "array",
            description:
              "One entry per changed file. Empty if nothing should change.",
            items: {
              type: "object",
              properties: {
                file: {
                  type: "string",
                  description: "Workflow filename only, e.g. claude-scout.yml",
                },
                newContent: {
                  type: "string",
                  description: "The complete new file content.",
                },
              },
              required: ["file", "newContent"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "changes"],
        additionalProperties: false,
      },
    });

    // Validate: only existing files, only real differences.
    const changes: FileChange[] = [];
    const rejected: string[] = [];
    for (const c of result.changes ?? []) {
      const name = (c.file ?? "").replace(/^\.github\/workflows\//, "").trim();
      const old = current.get(name);
      if (old === undefined) {
        rejected.push(name || "(unnamed file)");
        continue;
      }
      if (typeof c.newContent !== "string" || c.newContent === old) continue;
      changes.push({ file: name, oldContent: old, newContent: c.newContent });
    }

    let summary = result.summary ?? "";
    if (rejected.length) {
      summary += `\n\nNote: the draft tried to create or edit files that don't exist (${rejected.join(", ")}). Those were dropped — to add brand-new agents, ask Claude in the chat session.`;
    }

    return NextResponse.json({ summary, changes });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("loop-edit: failed", err);
    return NextResponse.json({ error: "Couldn't draft the change. Try again." }, { status: 502 });
  }
}
