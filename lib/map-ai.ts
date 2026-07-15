/**
 * Thin Anthropic Messages API client for the dashboard's AI drafting features.
 *
 * Deliberately raw `fetch` — no SDK dependency. Structured output is obtained
 * by forcing a tool call (`tool_choice: {type: "tool", name}`), which
 * guarantees the response is a single JSON object matching our schema instead
 * of free text we'd have to parse.
 *
 * Env:
 *   ANTHROPIC_API_KEY   — required; AI routes return 503 without it.
 *   DASHBOARD_AI_MODEL  — optional model override (default "claude-sonnet-5").
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 16000;

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function aiModel(): string {
  return process.env.DASHBOARD_AI_MODEL || "claude-sonnet-5";
}

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
  "AI drafting is turned off — add an Anthropic API key (ANTHROPIC_API_KEY) to enable it. History and manual editing still work.";

type JsonSchema = Record<string, unknown>;

/**
 * Call the Messages API with a single forced tool so the model must return
 * JSON matching `schema`. Returns the tool input object.
 */
export async function aiStructuredCall<T>(opts: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
}): Promise<T> {
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
        max_tokens: MAX_TOKENS,
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
    console.error("map-ai: network error", err);
    throw new AiError("Couldn't reach the AI service. Check your connection and try again.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`map-ai: API ${res.status}`, body.slice(0, 500));
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
    console.error("map-ai: no tool_use block in response", JSON.stringify(data).slice(0, 500));
    throw new AiError("The AI returned an unexpected answer. Try again.");
  }
  return toolBlock.input as T;
}
