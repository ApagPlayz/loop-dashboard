/**
 * AI drafting backend for the Process Map, with two interchangeable engines
 * behind one interface (`aiStructuredCall`):
 *
 *   1. "cli" — the local `claude` CLI (Claude Code), headless. Free on the
 *      owner's Claude Max subscription; used automatically when the binary is
 *      installed on the machine running the dashboard (i.e. the Mac).
 *      Invocation shape (verified against claude 2.1.210):
 *        claude -p --output-format json --model sonnet --tools "" \
 *               --no-session-persistence --append-system-prompt <sys> \
 *               --json-schema <schema> <prompt>
 *      → prints one JSON envelope; `result` is the answer text and, when
 *      --json-schema is used, `structured_output` carries the parsed object.
 *      Tools are fully disabled (--tools "") and the working directory is a
 *      throwaway temp dir, so the CLI can only answer — never touch files.
 *
 *   2. "api" — raw fetch to the Anthropic Messages API using
 *      ANTHROPIC_API_KEY, with forced tool use for structured output.
 *      The fallback for cloud deployments (e.g. Vercel) where no CLI exists.
 *
 * Selection: DASHBOARD_AI_BACKEND = cli | api | auto (default auto).
 *   auto → cli if the binary is found, else api if the key is set, else off.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 16000;
const CLI_TIMEOUT_MS = 120_000;

/** Error with a user-presentable message. */
export class AiError extends Error {
  constructor(
    message: string,
    /** HTTP status the API route should respond with. */
    public httpStatus: number = 502,
  ) {
    super(message);
  }
}

export const AI_DISABLED_MESSAGE =
  "AI drafting runs free through your Claude subscription when the dashboard runs on your Mac. In the cloud it needs an Anthropic API key (ANTHROPIC_API_KEY). History and manual editing still work either way.";

/* ------------------------------------------------------------------ */
/* Backend selection                                                   */
/* ------------------------------------------------------------------ */

export type AiBackend = "cli" | "api" | "disabled";

/**
 * Where the `claude` binary may live. Server processes get a slim PATH, so we
 * check the usual install spots directly (verified: on this Mac it lives at
 * ~/.local/bin/claude) in addition to whatever PATH contains.
 */
function cliCandidates(): string[] {
  const home = homedir();
  const fixed = [
    path.join(home, ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/bin/claude",
  ];
  const fromPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, "claude"));
  return [...fixed, ...fromPath];
}

let _cliPath: string | null | undefined; // undefined = not probed yet

/** Absolute path to the claude CLI, or null. Probed once and cached. */
export function findCli(): string | null {
  if (_cliPath !== undefined) return _cliPath;
  _cliPath = cliCandidates().find((p) => existsSync(p)) ?? null;
  return _cliPath;
}

/** Which backend will actually be used for AI calls. */
export function aiBackend(): AiBackend {
  const pref = (process.env.DASHBOARD_AI_BACKEND ?? "auto").toLowerCase();
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (pref === "cli") return findCli() ? "cli" : "disabled";
  if (pref === "api") return hasKey ? "api" : "disabled";
  // auto
  if (findCli()) return "cli";
  if (hasKey) return "api";
  return "disabled";
}

export function aiEnabled(): boolean {
  return aiBackend() !== "disabled";
}

/** Model for the API backend (full model id). */
export function aiModel(): string {
  return process.env.DASHBOARD_AI_MODEL || "claude-sonnet-5";
}

/** Model for the CLI backend (alias or full id both accepted). */
function cliModel(): string {
  return process.env.DASHBOARD_AI_MODEL || "sonnet";
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

type JsonSchema = Record<string, unknown>;

export type StructuredCallOpts = {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
  /** CLI backend: how long the local Claude app may run (default 120s). */
  timeoutMs?: number;
  /** API backend: output token cap (default 16000). */
  maxTokens?: number;
};

/**
 * Ask the AI for a JSON object matching `schema`. Routed to whichever backend
 * is available; both enforce the schema (API: forced tool use; CLI:
 * --json-schema plus defensive parsing with one retry).
 */
export async function aiStructuredCall<T>(opts: StructuredCallOpts): Promise<T> {
  const backend = aiBackend();
  if (backend === "cli") return cliStructuredCall<T>(opts);
  if (backend === "api") return apiStructuredCall<T>(opts);
  throw new AiError(AI_DISABLED_MESSAGE, 503);
}

/* ------------------------------------------------------------------ */
/* CLI backend                                                         */
/* ------------------------------------------------------------------ */

/** Throwaway working directory so the CLI never runs inside real code. */
function sandboxDir(): string {
  const dir = path.join(tmpdir(), "loop-dashboard-ai-sandbox");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return tmpdir();
  }
  return dir;
}

type CliEnvelope = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
};

function runCli(
  cliPath: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cliPath,
      args,
      {
        cwd: cwd ?? sandboxDir(),
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          // Make sure the CLI's own directory is on PATH for any helpers.
          PATH: `${path.dirname(cliPath)}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          console.error("map-ai(cli): exec failed", e.message, stderr?.slice(0, 500));
          if (e.killed || e.signal === "SIGTERM") {
            const mins = Math.round(timeoutMs / 60_000);
            reject(
              new AiError(
                `The AI ran for over ${mins} minute${mins === 1 ? "" : "s"} without finishing — this change is too big for one request. Ask for it in smaller pieces.`,
                504,
              ),
            );
          } else {
            reject(new AiError("Couldn't run the local Claude app. Try again."));
          }
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** Strip markdown fences / prose and parse the first {...} JSON object. */
function parseLoose(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last <= first) throw new Error("no JSON object found");
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function cliStructuredCall<T>(opts: StructuredCallOpts, isRetry = false): Promise<T> {
  const cliPath = findCli();
  if (!cliPath) throw new AiError(AI_DISABLED_MESSAGE, 503);

  const system = `${opts.system}

Output rules: respond with ONLY a single JSON object matching the required schema (${opts.toolDescription}). No markdown fences, no commentary before or after the JSON.`;

  const prompt = isRetry
    ? `${opts.user}

IMPORTANT: your previous reply was not valid JSON matching the schema. This time output ONLY the JSON object — nothing else.`
    : opts.user;

  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    cliModel(),
    "--tools",
    "", // no tools: the CLI may only answer, never act
    "--no-session-persistence",
    "--append-system-prompt",
    system,
    "--json-schema",
    JSON.stringify(opts.schema),
    prompt,
  ];

  const stdout = await runCli(cliPath, args, opts.timeoutMs ?? CLI_TIMEOUT_MS);

  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(stdout) as CliEnvelope;
  } catch {
    console.error("map-ai(cli): non-JSON envelope", stdout.slice(0, 500));
    throw new AiError("The local Claude app returned an unexpected answer. Try again.");
  }

  if (envelope.is_error || envelope.subtype !== "success") {
    console.error("map-ai(cli): error envelope", JSON.stringify(envelope).slice(0, 500));
    const hint = typeof envelope.result === "string" ? envelope.result.slice(0, 200) : "";
    throw new AiError(
      hint
        ? `The local Claude app reported a problem: ${hint}`
        : "The local Claude app reported a problem. Try again.",
    );
  }

  // Preferred: the CLI validated against --json-schema and parsed it for us.
  if (envelope.structured_output && typeof envelope.structured_output === "object") {
    return envelope.structured_output as T;
  }

  // Fallback: parse the result text defensively; one retry telling the model
  // its previous output wasn't valid JSON.
  try {
    return parseLoose(envelope.result ?? "") as T;
  } catch {
    if (!isRetry) {
      console.warn("map-ai(cli): JSON parse failed, retrying once");
      return cliStructuredCall<T>(opts, true);
    }
    console.error("map-ai(cli): parse failed twice", (envelope.result ?? "").slice(0, 500));
    throw new AiError("The AI couldn't produce a valid draft. Try rephrasing the request.");
  }
}

/* ------------------------------------------------------------------ */
/* CLI backend — plain-text chat (help assistant)                      */
/* ------------------------------------------------------------------ */

/**
 * Shown when the help assistant is asked to answer but no local `claude` CLI
 * exists (e.g. the dashboard is running in the cloud on Vercel). The assistant
 * is intentionally CLI-only: it bills to the owner's Claude subscription and
 * has no API-key fallback.
 */
export const ASSISTANT_CLI_UNAVAILABLE_MESSAGE =
  "The help assistant only works when the dashboard is running on your laptop (it talks to the Claude app you're logged into). It looks like the dashboard is running in the cloud right now, so the assistant is unavailable — everything else still works.";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatCallOpts = {
  /** Full system prompt describing the assistant's job. */
  system: string;
  /** The conversation so far, oldest first; the last item must be the user. */
  messages: ChatMessage[];
  /** How long the local Claude app may run (default 60s). */
  timeoutMs?: number;
  /**
   * Working directory to run the CLI in. When set to a project's local
   * checkout, the assistant can actually read that project's code (paired with
   * read-only `tools` below). Defaults to a throwaway sandbox so the assistant
   * can only answer, never touch real files.
   */
  cwd?: string;
  /**
   * Tool names to allow (e.g. ["Read", "Grep", "Glob"]). Empty/undefined =
   * no tools at all (answer-only). Only pass read-only tools here.
   */
  tools?: string[];
};

/** True when a plain-text CLI chat call can actually run right now. */
export function assistantAvailable(): boolean {
  return findCli() !== null;
}

/**
 * Ask the local `claude` CLI for a plain-text reply to a multi-turn
 * conversation. Reuses the same hardened invocation as the structured backend
 * (no tools, throwaway cwd, JSON envelope) but returns the free-form `result`
 * text instead of a schema-validated object. Always forces the Sonnet model so
 * the help assistant stays cheap. CLI-only — there is no API fallback.
 */
export async function aiChatCall(opts: ChatCallOpts): Promise<string> {
  const cliPath = findCli();
  if (!cliPath) throw new AiError(ASSISTANT_CLI_UNAVAILABLE_MESSAGE, 503);

  // The CLI takes a single prompt (session persistence is off), so flatten the
  // conversation into a transcript and ask it to reply to the latest turn.
  const transcript = opts.messages
    .map((m) => `${m.role === "user" ? "Owner" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  const prompt = `Conversation so far between you (the assistant) and the dashboard owner:

${transcript}

Write your next reply to the owner's most recent message. Reply with plain text only — no JSON, no preamble.`;

  // No tools by default (answer-only). When the caller passes read-only tools
  // AND a real cwd, the assistant can inspect that project's code.
  const toolsArg = opts.tools && opts.tools.length ? opts.tools.join(",") : "";

  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    "sonnet", // forced: keep the help assistant cheap
    "--tools",
    toolsArg,
    "--no-session-persistence",
    "--append-system-prompt",
    opts.system,
    prompt,
  ];

  const stdout = await runCli(cliPath, args, opts.timeoutMs ?? 60_000, opts.cwd);

  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(stdout) as CliEnvelope;
  } catch {
    console.error("map-ai(chat): non-JSON envelope", stdout.slice(0, 500));
    throw new AiError("The local Claude app returned an unexpected answer. Try again.");
  }

  if (envelope.is_error || envelope.subtype !== "success") {
    console.error("map-ai(chat): error envelope", JSON.stringify(envelope).slice(0, 500));
    const hint = typeof envelope.result === "string" ? envelope.result.slice(0, 200) : "";
    throw new AiError(
      hint
        ? `The local Claude app reported a problem: ${hint}`
        : "The local Claude app reported a problem. Try again.",
    );
  }

  const reply = (envelope.result ?? "").trim();
  if (!reply) throw new AiError("The assistant came back empty. Try asking again.");
  return reply;
}

/* ------------------------------------------------------------------ */
/* API backend (raw fetch + forced tool use)                           */
/* ------------------------------------------------------------------ */

async function apiStructuredCall<T>(opts: StructuredCallOpts): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiError(AI_DISABLED_MESSAGE, 503);

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: aiModel(),
        max_tokens: opts.maxTokens ?? MAX_TOKENS,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        tools: [
          {
            name: opts.toolName,
            description: opts.toolDescription,
            input_schema: opts.schema,
          },
        ],
        tool_choice: { type: "tool", name: opts.toolName },
      }),
    });
  } catch (err) {
    console.error("map-ai(api): network error", err);
    throw new AiError("Couldn't reach the AI service. Check your connection and try again.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`map-ai(api): API ${res.status}`, body.slice(0, 500));
    if (res.status === 401) {
      throw new AiError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.", 503);
    }
    if (res.status === 429) {
      throw new AiError("The AI service is rate-limited right now. Wait a minute and try again.");
    }
    if (res.status === 404) {
      throw new AiError(
        `The AI model "${aiModel()}" wasn't found. Check DASHBOARD_AI_MODEL.`,
        503,
      );
    }
    throw new AiError("The AI service returned an error. Try again in a moment.");
  }

  const data = (await res.json()) as {
    stop_reason?: string;
    content?: { type: string; input?: unknown }[];
  };

  if (data.stop_reason === "max_tokens") {
    throw new AiError(
      "The requested change was too large to draft in one go. Try asking for a smaller, more focused change.",
      422,
    );
  }
  if (data.stop_reason === "refusal") {
    throw new AiError("The AI declined this request. Try rephrasing it.", 422);
  }

  const toolBlock = data.content?.find((b) => b.type === "tool_use");
  if (!toolBlock || typeof toolBlock.input !== "object" || toolBlock.input === null) {
    console.error("map-ai(api): no tool_use block in response", JSON.stringify(data).slice(0, 500));
    throw new AiError("The AI returned an unexpected answer. Try again.");
  }
  return toolBlock.input as T;
}
