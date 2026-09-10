/**
 * Writing GitHub Actions secrets from the dashboard.
 *
 * Why this exists: every new project had the same manual step in the middle of
 * onboarding — leave the dashboard, open a terminal, run
 * `gh secret set CLAUDE_CODE_OAUTH_TOKEN`. That step is where setup died for
 * anyone without `gh` installed, and it is the one piece of the loop the
 * dashboard could always have done itself: its GITHUB_TOKEN carries
 * `secrets: write` (a PUT with deliberately-invalid ciphertext answers 422 —
 * "your payload is wrong" — not 403 "you may not").
 *
 * Two things guard the write, because the failure this feature is really about
 * is not a missing secret but a SILENTLY WRONG one:
 *
 *   - {@link validateOAuthToken} — a shape check. A previous session captured
 *     the token out of a terminal UI and got 79 characters of a 108-character
 *     token. GitHub stored it happily (a secret is just bytes to GitHub), and
 *     every agent run afterwards failed with an auth error that pointed
 *     nowhere near the real cause. Cheap local checks catch that class of
 *     mistake before it ever reaches the repo.
 *   - {@link verifyOAuthTokenLive} — one real call to Anthropic. The only
 *     honest answer to "is this token good?", and the only way to know before
 *     the owner finds out from a failed agent run hours later.
 *
 * SECRET HANDLING RULE for this whole file: the token value never leaves it.
 * It is not logged, not echoed back, not interpolated into an error message,
 * and not attached to a thrown error. Everything here sits one layer below an
 * API route, and route errors end up rendered in a browser.
 */

import { getOctokit, type RepoConfig } from "./github";

/**
 * The secret name the loop's workflows read. Named here so a caller cannot
 * typo it into a secret that exists but nothing looks at — a failure mode that
 * looks exactly like success on the dashboard's setup checklist.
 */
export const CLAUDE_OAUTH_SECRET_NAME = "CLAUDE_CODE_OAUTH_TOKEN";

/* ------------------------------------------------------------------ */
/* Writing the secret                                                  */
/* ------------------------------------------------------------------ */

/**
 * The slice of libsodium this file uses.
 *
 * Declared by hand instead of imported because of how the package initialises
 * itself: `libsodium-wrappers` exposes only a handful of helpers plus `ready`
 * when it is first loaded, and attaches `crypto_box_seal` and the rest of the
 * crypto surface onto the SAME module object once `ready` resolves. That is
 * invisible to a bundler doing static ESM analysis — Turbopack reads the
 * module's exports at build time, doesn't find `crypto_box_seal`, and fails
 * the route with "Export crypto_box_seal doesn't exist in target module"
 * *even though `tsc` is perfectly happy*, because the type stubs describe the
 * post-`ready` shape.
 *
 * So: no static import, and no reliance on the shipped types for the call
 * itself. {@link loadSodium} resolves the module at runtime instead.
 */
type SodiumLike = {
  ready: Promise<void>;
  crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  from_base64(input: string, variant: number): Uint8Array;
  from_string(input: string): Uint8Array;
  to_base64(input: Uint8Array, variant: number): string;
  base64_variants: { ORIGINAL: number };
};

/**
 * Load libsodium and wait for it to finish initialising.
 *
 * The `.default ?? mod` dance is not defensive noise: this package is CJS, and
 * whether a dynamic import hands back the module object itself or wraps it in
 * `.default` depends on which loader is running — Turbopack in the app,
 * Vite/vitest in the tests, plain Node in a script. Reaching for one and not
 * the other breaks the file in exactly one of those three places.
 */
async function loadSodium(): Promise<SodiumLike> {
  const mod = await import("libsodium-wrappers");
  const sodium = ((mod as { default?: unknown }).default ?? mod) as unknown as SodiumLike;
  // libsodium initialises its compiled core asynchronously, and the crypto
  // functions do not exist on the module until this resolves. It resolves once
  // per process, so every call after the first is free.
  await sodium.ready;
  return sodium;
}

/**
 * Create or replace an Actions secret on `repo`.
 *
 * GitHub never accepts a secret in the clear: you fetch the repository's
 * public key, seal the value to it, and send the ciphertext plus the key's id.
 * A "sealed box" (`crypto_box_seal`) is the right primitive because it needs
 * no keypair of our own — libsodium generates an ephemeral one, uses it once
 * and discards it, so only GitHub's private key can ever open the result.
 *
 * The two base64 variants below are passed explicitly ON PURPOSE. libsodium's
 * default variant is URL-safe and unpadded; GitHub speaks standard base64 in
 * both directions. Relying on the default produces a value that encodes and
 * decodes fine locally and is rejected at the other end.
 */
export async function setRepoSecret(
  repo: RepoConfig,
  name: string,
  value: string,
): Promise<void> {
  const sodium = await loadSodium();
  const octokit = getOctokit();

  const { data: publicKey } = await octokit.rest.actions.getRepoPublicKey({
    owner: repo.owner,
    repo: repo.repo,
  });

  const keyBytes = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
  const encryptedValue = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

  await octokit.rest.actions.createOrUpdateRepoSecret({
    owner: repo.owner,
    repo: repo.repo,
    secret_name: name,
    encrypted_value: encryptedValue,
    key_id: publicKey.key_id,
  });
}

/* ------------------------------------------------------------------ */
/* Shape validation                                                    */
/* ------------------------------------------------------------------ */

export type TokenShapeResult = { ok: true } | { ok: false; reason: string };

/**
 * The length below which we refuse to write a token at all.
 *
 * The real token observed in the wild is 108 characters; the truncated one
 * that caused the original incident was 79. This threshold sits between them,
 * deliberately closer to the real length: anything that lost a chunk to a
 * clipped terminal window falls well under it, while a future token format
 * that grows or shrinks a little still gets through to the live check, which
 * is the real authority on whether a token works. A shape check should only
 * ever reject what cannot possibly be right.
 */
const MIN_PLAUSIBLE_LENGTH = 90;

/**
 * Characters that have no business being inside a token: every kind of
 * whitespace, plus the ASCII control range and DEL. In practice they all mean
 * the same thing — the value arrived in more than one piece, usually because a
 * terminal wrapped it across two lines — and the resulting secret is broken in
 * a way nothing downstream will explain to you.
 */
const BROKEN_TOKEN_CHARS = /[\s\u0000-\u001f\u007f]/;

/**
 * A cheap, local sanity check on a pasted token — shape only, no network.
 *
 * It answers exactly one question: "could this string plausibly be a whole
 * token?". It cannot and does not say whether the token is valid; that is
 * {@link verifyOAuthTokenLive}'s job.
 *
 * Surrounding whitespace is forgiven (a paste routinely brings a trailing
 * newline along) — callers should trim before storing, the same way this trims
 * before checking. Whitespace INSIDE the token is not forgiven.
 *
 * Every reason below is written for the person holding the token, not for a
 * developer reading a log: it says what went wrong and what to do about it.
 */
export function validateOAuthToken(value: string): TokenShapeResult {
  const token = typeof value === "string" ? value.trim() : "";

  if (!token) {
    return {
      ok: false,
      reason: "The token box is empty. Paste your Claude Code token and try again.",
    };
  }

  if (BROKEN_TOKEN_CHARS.test(token)) {
    return {
      ok: false,
      reason:
        "That token has a space or a line break inside it, so it isn't one unbroken " +
        "piece. Copy it again in one go — if your terminal wrapped it onto two lines, " +
        "widen the window first.",
    };
  }

  if (token.length < MIN_PLAUSIBLE_LENGTH) {
    return {
      ok: false,
      reason:
        `That token looks cut short — it's ${token.length} characters and a real one is ` +
        "around 108. This normally means the end was clipped when it was copied. Select " +
        "the whole token, right to the last character, and paste it again.",
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Live verification                                                   */
/* ------------------------------------------------------------------ */

/**
 * The result of asking Anthropic whether a token works.
 *
 * `inconclusive` carries the distinction the caller cannot afford to lose:
 * "Anthropic said no" and "we never got an answer" are both `ok: false`, but
 * the first means the owner has to fix their token and the second means our
 * check failed and the token may well be fine. Collapsing them would send
 * people off to re-copy a perfectly good token every time Anthropic has a
 * wobble — and, worse, would make "unverified" indistinguishable from
 * "verified bad" at the point where we decide whether to write.
 */
export type LiveVerifyResult = {
  ok: boolean;
  detail: string;
  inconclusive: boolean;
};

/**
 * The cheapest model that proves a token authenticates. We read the HTTP
 * status, never the answer, so the smallest and fastest model wins.
 */
const VERIFY_MODEL = "claude-haiku-4-5";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

/**
 * Long enough for a cold API call, short enough that a hung check doesn't turn
 * into a hung page for someone sitting on the setup screen.
 */
const VERIFY_TIMEOUT_MS = 10_000;

/**
 * Ask Anthropic, in one minimal request, whether this token is accepted.
 *
 * `max_tokens: 1` keeps the call as close to free as an authenticated request
 * gets. The reply stops at the length limit immediately, which is fine: a 200
 * already proves the token authenticates, and that is the entire question.
 *
 * The headers are the OAuth shape, not the API-key shape. A
 * CLAUDE_CODE_OAUTH_TOKEN is an OAuth access token, so it travels on
 * `Authorization: Bearer` alongside the oauth beta flag; sending it as
 * `x-api-key` comes back 401 and we would then tell the owner that a perfectly
 * good token had been rejected.
 *
 * Never throws. Anything unexpected becomes `inconclusive` — see
 * {@link LiveVerifyResult} for why that distinction is load-bearing.
 */
export async function verifyOAuthTokenLive(value: string): Promise<LiveVerifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${value}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
      },
      body: JSON.stringify({
        model: VERIFY_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: controller.signal,
    });

    if (res.ok) {
      return {
        ok: true,
        inconclusive: false,
        detail: "Anthropic accepted that token.",
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        inconclusive: false,
        detail:
          "That token was rejected by Anthropic. It may have been revoked, or only part " +
          "of it was copied. Generate a fresh one and paste the whole thing.",
      };
    }

    // Every other status is about US, not about the token: a rate limit, an
    // outage, a model name we got wrong. Reporting one of those as "bad token"
    // is the lie that costs somebody an hour.
    return {
      ok: false,
      inconclusive: true,
      detail:
        `Couldn't check the token — Anthropic answered with an unexpected status ` +
        `(${res.status}). That doesn't mean the token is wrong; the check itself didn't ` +
        "run.",
    };
  } catch {
    // A timeout (our own abort) and a DNS/socket failure tell the owner the
    // same story. The error object is deliberately never read: this function's
    // input is a secret, and nothing derived from that request should end up
    // in a message someone might paste into an issue.
    return {
      ok: false,
      inconclusive: true,
      detail:
        "Couldn't reach Anthropic to check the token, so we don't know whether it works. " +
        "That's a problem with the check rather than the token — try again in a moment.",
    };
  } finally {
    clearTimeout(timer);
  }
}
