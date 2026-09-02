// Relative, not "@/lib/...": vitest.config.mts builds its "@" alias from a URL
// pathname, which percent-encodes the spaces in this repo's path, so the alias
// does not resolve under the test runner.
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN, defuse, untrustedPreamble } from "./prompt-safety";

/**
 * Guardrails for caller-supplied text this dashboard RELAYS INTO A REPO, where a
 * CI agent will read it.
 *
 * `prompt-safety.ts` is the mirror image: text coming FROM GitHub INTO our own
 * prompts. This module is text going the other way, and it is the more dangerous
 * direction, because of how the target repo's mention workflow is gated.
 *
 * THE GATE INVERSION. `config/loop-template/workflows/claude-mention.yml` wakes an
 * agent on any issue or comment containing "@claude", and guards it by asking the
 * GitHub API for the COMMENT AUTHOR's permission on the repo, accepting only
 * `admin` or `maintain`. That check is sound when a person comments. It is
 * useless when WE comment: the author of anything the dashboard posts is the
 * dashboard's own GitHub token, which is an admin. The gate therefore passes
 * automatically for every relayed message, and the caller's words arrive in a job
 * holding `contents: write`, `pull-requests: write`, `issues: write`,
 * `actions: write`, with Bash in its allowed tools. A control meant to answer
 * "may this person steer the agent?" instead certifies whatever we forward — it
 * is inverted into an amplifier.
 *
 * The routes that do this are authenticated (proxy.ts requires a session), and
 * that is the first line of defence. This module is the second, for the cases
 * where the first does not hold: a guessed password, a future read-only or demo
 * deployment, or any other path that reaches those routes. The rule it enforces
 * is simple — the caller's portion of a relayed message must be incapable of
 * driving the agent:
 *
 *   - `sanitizeUntrustedText()` caps its length, strips characters that hide text
 *     from a human reviewer, defuses the fence markers, and defangs @-mentions.
 *   - `untrustedBlock()` fences what is left as data, with the same preamble the
 *     chat routes use.
 *
 * The "@claude" that deliberately wakes the agent is added by the route, OUTSIDE
 * the fence. It is our text, not the caller's, and it is the only live mention in
 * anything we post.
 */

/**
 * How much caller-supplied text we are willing to relay into an agent-visible
 * comment or issue. Matches the per-message cap the chat routes already enforce.
 * GitHub itself allows 65536 characters — far more room than a genuine request
 * needs, and far more than we want to hand an agent unreviewed.
 */
export const MAX_RELAYED_CHARS = 4000;

/**
 * Make every @-mention in caller text inert before it reaches GitHub.
 *
 * "@claude" is the mention workflow's trigger word, and other bots watch for
 * their own handles. An "@" followed by a name character becomes a literal
 * "(at)": visible in the rendered comment, obvious to a reader, and incapable of
 * matching either GitHub's mention parser or the workflow's
 * `contains(body, '@claude')` string test. A bare "@" in prose is left alone.
 */
export function neutralizeMentions(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9])/g, "(at)");
}

/**
 * Remove Unicode control and format characters — zero-width spaces, joiners,
 * bidirectional overrides, BOMs. They render as nothing to the human reviewing
 * an issue while the agent still reads them, which is precisely the gap this
 * module exists to close. Tab and newline are legitimate and are kept.
 */
export function stripInvisibles(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, (ch) => {
    const code = ch.codePointAt(0);
    return code === 9 || code === 10 ? ch : "";
  });
}

/** The outcome of checking one piece of caller-supplied text. */
export type SanitizeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Validate and clean one field of caller-supplied text before it is relayed.
 *
 * Rejects rather than truncates when it is too long: silently cutting a request
 * in half sends the agent a mangled instruction nobody actually wrote, which is
 * its own failure mode. The caller gets a 4xx and can shorten it themselves.
 */
export function sanitizeRelayedText(
  value: unknown,
  opts: { emptyError: string; longError: string; maxChars?: number },
): SanitizeResult {
  if (typeof value !== "string") return { ok: false, error: opts.emptyError };
  const max = opts.maxChars ?? MAX_RELAYED_CHARS;
  const cleaned = stripInvisibles(value).trim();
  if (!cleaned) return { ok: false, error: opts.emptyError };
  if (cleaned.length > max) return { ok: false, error: opts.longError };
  return { ok: true, text: neutralizeMentions(defuse(cleaned)) };
}

/**
 * Fence already-sanitized caller text for the agent that will read it, using the
 * same markers and the same wording as the chat routes.
 *
 * `authors` says who wrote the fenced text. Be honest in it: a message relayed by
 * the dashboard is posted under the dashboard's own GitHub identity, which proves
 * nothing about who typed it.
 *
 * Pass text that has been through `sanitizeRelayedText()` — this function fences,
 * it does not clean.
 */
export function relayedBlock(text: string, authors: string): string {
  return [untrustedPreamble(authors), "", UNTRUSTED_OPEN, text, UNTRUSTED_CLOSE].join("\n");
}

/**
 * Validate a caller-supplied issue or PR number. GitHub numbers them from 1, so
 * anything non-integer, zero or negative is a malformed request, not a lookup.
 *
 * Only a number or a numeric string counts: `Number(true)` is 1 and
 * `Number(null)` is 0, and coercing junk is how a malformed request turns into a
 * write against a real issue.
 */
export function parseIssueNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** Check a caller-supplied string against an explicit allowlist. */
export function pickAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}
