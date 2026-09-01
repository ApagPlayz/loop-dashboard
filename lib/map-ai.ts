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
 *   3. "bedrock" — Claude on Amazon Bedrock via @anthropic-ai/bedrock-sdk.
 *      No API key: the SDK signs requests with SigV4 using the default AWS
 *      credential chain, so on ECS it authenticates with the task role and
 *      locally with AWS_PROFILE / AWS_* env vars. Same forced-tool-use trick
 *      as "api" — tool use (including tool_choice: {type:"tool"}) is GA on
 *      Bedrock, so the parsing below is shared. Two Bedrock APIs exist and
 *      they take DIFFERENT model ids; see BEDROCK_MODEL_IDS.
 *
 * Selection: DASHBOARD_AI_BACKEND = cli | api | bedrock | auto (default auto).
 *   auto → cli if the binary is found, else bedrock if configured, else api if
 *   the key is set, else off.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import type { AnthropicBedrock, AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 16000;
const CLI_TIMEOUT_MS = 120_000;
const CHAT_TIMEOUT_MS = 60_000;

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
  "AI drafting runs free through your Claude subscription when the dashboard runs on your Mac. In the cloud it needs either AWS Bedrock access (DASHBOARD_AI_BEDROCK_REGION) or an Anthropic API key (ANTHROPIC_API_KEY). History and manual editing still work either way.";

/* ------------------------------------------------------------------ */
/* Backend selection                                                   */
/* ------------------------------------------------------------------ */

export type AiBackend = "cli" | "api" | "bedrock" | "disabled";

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

/**
 * Which Bedrock API to talk to. They are NOT interchangeable — different
 * endpoints, different model-id shapes (see BEDROCK_MODEL_IDS).
 *   "mantle" (default) — the Messages-API endpoint, bedrock-mantle.{region}.api.aws.
 *   "invoke"           — the legacy bedrock-runtime InvokeModel path, the one
 *                        claude-code-action uses in the loop workflows.
 */
export type BedrockApi = "mantle" | "invoke";

function bedrockApi(): BedrockApi {
  return (process.env.DASHBOARD_AI_BEDROCK_API ?? "").toLowerCase() === "invoke"
    ? "invoke"
    : "mantle";
}

/**
 * Region for Bedrock. DASHBOARD_AI_BEDROCK_REGION is the explicit opt-in;
 * AWS_REGION / AWS_DEFAULT_REGION are what ECS and the AWS CLI already set.
 */
function bedrockRegion(): string | undefined {
  return (
    process.env.DASHBOARD_AI_BEDROCK_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    undefined
  );
}

/**
 * True when Bedrock is configured enough to try. Credentials are deliberately
 * NOT checked here: the SDK resolves them from the default AWS chain (ECS task
 * role, SSO, ~/.aws, IMDS), which we cannot probe cheaply or synchronously.
 * A region is the one thing that must be pinned by config.
 */
function bedrockConfigured(): boolean {
  return !!bedrockRegion();
}

/** Which backend will actually be used for AI calls. */
export function aiBackend(): AiBackend {
  const pref = (process.env.DASHBOARD_AI_BACKEND ?? "auto").toLowerCase();
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (pref === "cli") return findCli() ? "cli" : "disabled";
  if (pref === "api") return hasKey ? "api" : "disabled";
  if (pref === "bedrock") return bedrockConfigured() ? "bedrock" : "disabled";
  // auto: the local CLI first — it's free on the owner's Mac and unchanged.
  if (findCli()) return "cli";
  // Then Bedrock, which needs no key at all (ECS task role / AWS profile).
  // A bare AWS_REGION is a weak signal — plenty of machines export one — so in
  // auto it only wins when there's no Anthropic key to prefer. Setting
  // DASHBOARD_AI_BEDROCK_REGION (or DASHBOARD_AI_BACKEND=bedrock) is explicit
  // and always wins.
  if (process.env.DASHBOARD_AI_BEDROCK_REGION) return "bedrock";
  if (bedrockConfigured() && !hasKey) return "bedrock";
  if (hasKey) return "api";
  return "disabled";
}

export function aiEnabled(): boolean {
  return aiBackend() !== "disabled";
}

/* ------------------------------------------------------------------ */
/* Model ids — ONE mapping, so the backends can't drift apart          */
/* ------------------------------------------------------------------ */

/**
 * DASHBOARD_AI_MODEL is always written as a first-party Anthropic model id
 * (e.g. "claude-sonnet-5"). Everything else is derived from it here, so a
 * model change is a one-line change and the Bedrock/non-Bedrock ids can never
 * silently drift apart (plan risk R10).
 *
 * Verified against platform.claude.com on 2026-08-31:
 *   - "mantle" ids carry an `anthropic.` provider prefix and NO version suffix
 *     and NO inference-profile prefix.
 *   - "invoke" (legacy bedrock-runtime) ids are cross-region *inference
 *     profiles*: a `global.` / `us.` / `eu.` / `jp.` / `apac.` prefix in front
 *     of the ARN-versioned base id. Passing the bare base id there 400s with
 *     "Invocation of model ID ... with on-demand throughput isn't supported".
 *     Swap the `global.` prefix for a regional one if you need data residency
 *     (10% price premium), via DASHBOARD_AI_BEDROCK_MODEL.
 *   - The current 5-series models are reachable over InvokeModel but AWS
 *     publishes no ARN-versioned id for them, so they have no `invoke` entry:
 *     use the mantle API, or pin DASHBOARD_AI_BEDROCK_MODEL yourself.
 */
const BEDROCK_MODEL_IDS: Record<string, { mantle: string; invoke?: string }> = {
  "claude-fable-5": { mantle: "anthropic.claude-fable-5" },
  "claude-opus-5": { mantle: "anthropic.claude-opus-5" },
  "claude-opus-4-8": { mantle: "anthropic.claude-opus-4-8" },
  "claude-opus-4-7": { mantle: "anthropic.claude-opus-4-7" },
  "claude-sonnet-5": { mantle: "anthropic.claude-sonnet-5" },
  "claude-haiku-4-5": {
    mantle: "anthropic.claude-haiku-4-5",
    invoke: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  },
  "claude-opus-4-6": { mantle: "anthropic.claude-opus-4-6", invoke: "global.anthropic.claude-opus-4-6-v1" },
  "claude-sonnet-4-6": {
    mantle: "anthropic.claude-sonnet-4-6",
    invoke: "global.anthropic.claude-sonnet-4-6",
  },
  "claude-sonnet-4-5": {
    mantle: "anthropic.claude-sonnet-4-5",
    invoke: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  },
};

/** A model id that is already Bedrock-shaped (provider or profile prefixed). */
function looksBedrockShaped(id: string): boolean {
  return /^(anthropic|global|us|eu|jp|au|apac|us-gov)\./.test(id);
}

/** The canonical first-party model id the dashboard is configured for. */
function canonicalModel(): string {
  const id = process.env.DASHBOARD_AI_MODEL || "claude-sonnet-5";
  if (looksBedrockShaped(id)) {
    console.warn(
      `map-ai: DASHBOARD_AI_MODEL="${id}" looks like a Bedrock model id. It must be a first-party id (e.g. "claude-sonnet-5"); set DASHBOARD_AI_BEDROCK_MODEL to override the Bedrock id.`,
    );
  }
  return id;
}

/** Model for the API backend (full model id). */
export function aiModel(): string {
  return canonicalModel();
}

/** Model for the CLI backend (alias or full id both accepted). */
function cliModel(): string {
  return process.env.DASHBOARD_AI_MODEL || "sonnet";
}

/**
 * Model id to send to Bedrock. DASHBOARD_AI_BEDROCK_MODEL always wins; else
 * the canonical id is translated for whichever Bedrock API is in use.
 */
export function bedrockModel(): string {
  const override = process.env.DASHBOARD_AI_BEDROCK_MODEL;
  if (override) return override;

  const canonical = canonicalModel();
  if (looksBedrockShaped(canonical)) return canonical; // already translated by hand

  const api = bedrockApi();
  const entry = BEDROCK_MODEL_IDS[canonical];
  const id = entry?.[api];
  if (!id) {
    throw new AiError(
      `No Bedrock ${api} model id is known for "${canonical}". Set DASHBOARD_AI_BEDROCK_MODEL to the exact Bedrock id (or inference-profile id) you want to use.`,
      503,
    );
  }
  return id;
}

/**
 * Cheap model for the plain-text help assistant, mirroring the CLI backend's
 * hardcoded "sonnet". Overridable, and translated through the same table.
 */
function chatCanonicalModel(): string {
  return process.env.DASHBOARD_AI_CHAT_MODEL || "claude-sonnet-5";
}

function bedrockChatModel(): string {
  const override = process.env.DASHBOARD_AI_BEDROCK_CHAT_MODEL;
  if (override) return override;
  const canonical = chatCanonicalModel();
  if (looksBedrockShaped(canonical)) return canonical;
  const api = bedrockApi();
  const id = BEDROCK_MODEL_IDS[canonical]?.[api];
  if (!id) {
    throw new AiError(
      `No Bedrock ${api} model id is known for "${canonical}". Set DASHBOARD_AI_BEDROCK_CHAT_MODEL to the exact Bedrock id you want the help assistant to use.`,
      503,
    );
  }
  return id;
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
  /**
   * CLI backend only: working directory to run the CLI in. When set to a
   * project's local checkout (paired with read-only `tools` below), the model
   * can actually read that project's code while producing structured output.
   * Defaults to a throwaway sandbox. Ignored by the API backend.
   */
  cwd?: string;
  /**
   * CLI backend only: tool names to allow (e.g. ["Read", "Grep", "Glob"]).
   * Empty/undefined = no tools at all (answer-only). Only pass read-only tools
   * here. Ignored by the API backend.
   */
  tools?: string[];
};

/**
 * Ask the AI for a JSON object matching `schema`. Routed to whichever backend
 * is available; both enforce the schema (API: forced tool use; CLI:
 * --json-schema plus defensive parsing with one retry).
 */
export async function aiStructuredCall<T>(opts: StructuredCallOpts): Promise<T> {
  const backend = aiBackend();
  if (backend === "cli") return cliStructuredCall<T>(opts);
  if (backend === "bedrock") return bedrockStructuredCall<T>(opts);
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
export function parseLoose(text: string): unknown {
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

  // No tools by default (answer-only). When the caller passes read-only tools
  // AND a real cwd, the model can inspect that project's code while still
  // returning schema-validated JSON.
  const toolsArg = opts.tools && opts.tools.length ? opts.tools.join(",") : "";

  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    cliModel(),
    "--tools",
    toolsArg,
    "--no-session-persistence",
    "--append-system-prompt",
    system,
    "--json-schema",
    JSON.stringify(opts.schema),
    prompt,
  ];

  const stdout = await runCli(cliPath, args, opts.timeoutMs ?? CLI_TIMEOUT_MS, opts.cwd);

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
 * Shown when the help assistant is asked to answer but no backend at all is
 * available. It used to mean "no local CLI" — the assistant was CLI-only and
 * therefore dead in any cloud deploy. It now runs on whichever backend
 * aiBackend() picks (CLI on the Mac, Bedrock or the Anthropic API in the
 * cloud), so this only fires when AI is switched off entirely.
 */
export const ASSISTANT_CLI_UNAVAILABLE_MESSAGE =
  "The help assistant needs an AI backend. On your laptop it uses the Claude app you're logged into; in the cloud it needs AWS Bedrock access (DASHBOARD_AI_BEDROCK_REGION) or an Anthropic API key. Everything else still works.";

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

/** True when a plain-text chat call can actually run right now, on any backend. */
export function assistantAvailable(): boolean {
  return aiBackend() !== "disabled";
}

/**
 * True when the chat call will run through the local CLI — i.e. when `cwd` +
 * read-only `tools` will actually be honoured. The hosted backends can only
 * answer from the conversation they're given.
 */
export function assistantCanReadCode(): boolean {
  return aiBackend() === "cli";
}

/**
 * Ask the AI for a plain-text reply to a multi-turn conversation. Routed to
 * whichever backend is available, mirroring `aiStructuredCall`. Always forces
 * a Sonnet-class model so the help assistant stays cheap.
 *
 * Only the CLI backend honours `cwd` / `tools` (it can read a real checkout);
 * the hosted backends ignore them and answer from the conversation alone, the
 * same way `apiStructuredCall` ignores them.
 */
export async function aiChatCall(opts: ChatCallOpts): Promise<string> {
  const backend = aiBackend();
  if (backend === "cli") return cliChatCall(opts);
  if (backend === "bedrock") return bedrockChatCall(opts);
  if (backend === "api") return apiChatCall(opts);
  throw new AiError(ASSISTANT_CLI_UNAVAILABLE_MESSAGE, 503);
}

/**
 * Ask the local `claude` CLI for a plain-text reply to a multi-turn
 * conversation. Reuses the same hardened invocation as the structured backend
 * (no tools, throwaway cwd, JSON envelope) but returns the free-form `result`
 * text instead of a schema-validated object. Always forces the Sonnet model so
 * the help assistant stays cheap.
 */
async function cliChatCall(opts: ChatCallOpts): Promise<string> {
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

  const stdout = await runCli(cliPath, args, opts.timeoutMs ?? CHAT_TIMEOUT_MS, opts.cwd);

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

/** Map an Anthropic/Bedrock HTTP status onto a user-presentable AiError. */
export function httpStatusError(status: number, model: string): AiError {
  if (status === 401 || status === 403) {
    return new AiError(
      "The AI service rejected our credentials. Check ANTHROPIC_API_KEY (api backend) or the AWS role's Bedrock permissions (bedrock backend).",
      503,
    );
  }
  if (status === 429) {
    return new AiError("The AI service is rate-limited right now. Wait a minute and try again.");
  }
  if (status === 404) {
    return new AiError(
      `The AI model "${model}" wasn't found. Check DASHBOARD_AI_MODEL (and DASHBOARD_AI_BEDROCK_MODEL / the model's region access on Bedrock).`,
      503,
    );
  }
  return new AiError("The AI service returned an error. Try again in a moment.");
}

/** Map a Messages-API stop_reason onto an AiError, or null when it's fine. */
export function stopReasonError(stopReason: string | null | undefined): AiError | null {
  if (stopReason === "max_tokens") {
    return new AiError(
      "The requested change was too large to draft in one go. Try asking for a smaller, more focused change.",
      422,
    );
  }
  if (stopReason === "refusal") {
    return new AiError("The AI declined this request. Try rephrasing it.", 422);
  }
  return null;
}

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
    throw httpStatusError(res.status, aiModel());
  }

  const data = (await res.json()) as {
    stop_reason?: string;
    content?: { type: string; input?: unknown }[];
  };

  const stopErr = stopReasonError(data.stop_reason);
  if (stopErr) throw stopErr;

  const toolBlock = data.content?.find((b) => b.type === "tool_use");
  if (!toolBlock || typeof toolBlock.input !== "object" || toolBlock.input === null) {
    console.error("map-ai(api): no tool_use block in response", JSON.stringify(data).slice(0, 500));
    throw new AiError("The AI returned an unexpected answer. Try again.");
  }
  return toolBlock.input as T;
}

/* ------------------------------------------------------------------ */
/* API backend — plain-text chat (help assistant)                      */
/* ------------------------------------------------------------------ */

/**
 * The help assistant on the Anthropic API. Same shape as the CLI path but a
 * real multi-turn `messages` array instead of a flattened transcript, and no
 * tools — this backend can only answer, never read code.
 */
async function apiChatCall(opts: ChatCallOpts): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiError(ASSISTANT_CLI_UNAVAILABLE_MESSAGE, 503);

  const model = chatCanonicalModel();

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? CHAT_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: opts.system,
        messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  } catch (err) {
    console.error("map-ai(chat/api): network error", err);
    throw new AiError("Couldn't reach the AI service. Check your connection and try again.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`map-ai(chat/api): API ${res.status}`, body.slice(0, 500));
    throw httpStatusError(res.status, model);
  }

  const data = (await res.json()) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  };

  if (data.stop_reason === "refusal") {
    throw new AiError("The assistant declined that one. Try rephrasing it.", 422);
  }

  const reply = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!reply) throw new AiError("The assistant came back empty. Try asking again.");
  return reply;
}

/* ------------------------------------------------------------------ */
/* Bedrock backend (SDK + SigV4, forced tool use)                      */
/* ------------------------------------------------------------------ */

type BedrockClient = AnthropicBedrock | AnthropicBedrockMantle;

let _bedrockClient: BedrockClient | undefined;
let _bedrockClientKey: string | undefined;

/**
 * The Bedrock client, built once and reused.
 *
 * Deliberately no credentials are passed: the SDK falls through to the default
 * AWS provider chain, which is the ECS task role in the container, and
 * AWS_PROFILE / AWS_* env vars / SSO on a developer's machine. Never require
 * keys in config.
 *
 * The SDK also signs (SigV4) and, on the legacy InvokeModel path, injects the
 * required `anthropic_version: "bedrock-2023-05-31"` body field for us — which
 * is exactly why this path uses the SDK rather than a hand-rolled fetch like
 * the `api` backend.
 */
async function getBedrockClient(): Promise<BedrockClient> {
  const region = bedrockRegion();
  if (!region) {
    throw new AiError(
      "Bedrock is selected but no region is set. Set DASHBOARD_AI_BEDROCK_REGION (or AWS_REGION).",
      503,
    );
  }
  const api = bedrockApi();
  const key = `${api}:${region}`;
  if (_bedrockClient && _bedrockClientKey === key) return _bedrockClient;

  // Imported lazily so the CLI and API backends never pay for loading the AWS
  // signing stack.
  const { AnthropicBedrock: Legacy, AnthropicBedrockMantle: Mantle } = await import(
    "@anthropic-ai/bedrock-sdk"
  );
  _bedrockClient = api === "invoke" ? new Legacy({ awsRegion: region }) : new Mantle({ awsRegion: region });
  _bedrockClientKey = key;
  return _bedrockClient;
}

/** Turn an SDK error into the same user-presentable AiError shape as `api`. */
function bedrockError(err: unknown, model: string, label: string): AiError {
  if (err instanceof AiError) return err;
  const status = (err as { status?: unknown })?.status;
  console.error(
    `map-ai(${label}): Bedrock error`,
    typeof status === "number" ? status : "",
    (err as { message?: string })?.message?.slice(0, 500) ?? err,
  );
  if (typeof status === "number") {
    if (status === 403) {
      return new AiError(
        "AWS rejected the Bedrock call. Check the task role's bedrock permissions and that this model is granted in this region.",
        503,
      );
    }
    return httpStatusError(status, model);
  }
  return new AiError("Couldn't reach AWS Bedrock. Try again in a moment.");
}

/**
 * Structured output on Bedrock. Forced tool use — `tools` plus
 * `tool_choice: {type:"tool", name}` — is plain tool use, which is GA on both
 * Bedrock APIs, so the request and the `tool_use`-block parsing are identical
 * to the `api` backend above.
 *
 * Note: do NOT "upgrade" this to `output_config.format` (structured outputs).
 * That parameter is documented as unsupported on the Bedrock Messages endpoint
 * and would break this path.
 */
async function bedrockStructuredCall<T>(opts: StructuredCallOpts): Promise<T> {
  const model = bedrockModel();
  let message;
  try {
    const client = await getBedrockClient();
    message = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? MAX_TOKENS,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: opts.schema as { type: "object" } & Record<string, unknown>,
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
    });
  } catch (err) {
    throw bedrockError(err, model, "bedrock");
  }

  const stopErr = stopReasonError(message.stop_reason);
  if (stopErr) throw stopErr;

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || typeof toolBlock.input !== "object" || toolBlock.input === null) {
    console.error(
      "map-ai(bedrock): no tool_use block in response",
      JSON.stringify(message.content).slice(0, 500),
    );
    throw new AiError("The AI returned an unexpected answer. Try again.");
  }
  return toolBlock.input as T;
}

/** The help assistant on Bedrock: same client, plain text, no tools. */
async function bedrockChatCall(opts: ChatCallOpts): Promise<string> {
  const model = bedrockChatModel();
  let message;
  try {
    const client = await getBedrockClient();
    message = await client.messages.create(
      {
        model,
        max_tokens: 2048,
        system: opts.system,
        messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      },
      { timeout: opts.timeoutMs ?? CHAT_TIMEOUT_MS },
    );
  } catch (err) {
    throw bedrockError(err, model, "chat/bedrock");
  }

  if (message.stop_reason === "refusal") {
    throw new AiError("The assistant declined that one. Try rephrasing it.", 422);
  }

  const reply = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!reply) throw new AiError("The assistant came back empty. Try asking again.");
  return reply;
}
