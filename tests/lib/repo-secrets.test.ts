import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// The secret writer talks to GitHub through lib/github's shared Octokit. Mock
// the module so nothing in this file can reach the network — and so the
// encryption can be checked end to end against a keypair we hold the private
// half of.
vi.mock("../../lib/github", () => ({ getOctokit: vi.fn() }));

import { getOctokit } from "../../lib/github";
import {
  CLAUDE_OAUTH_SECRET_NAME,
  setRepoSecret,
  validateOAuthToken,
  verifyOAuthTokenLive,
} from "../../lib/repo-secrets";

/**
 * These tests exist because of one specific incident, not for coverage.
 *
 * A previous session captured a CLAUDE_CODE_OAUTH_TOKEN out of a terminal UI
 * and got 79 characters of a 108-character token. GitHub accepted it without
 * complaint — a secret is just bytes to GitHub — and every agent run afterwards
 * failed with an auth error that pointed nowhere near the real cause. Half the
 * assertions below are about that class of failure: a token that is WRONG but
 * looks fine, and a check that CANNOT RUN being mistaken for a token that is
 * bad.
 */

/** A plausible whole token: the real one observed in the wild was 108 chars. */
const FULL_TOKEN = "sk-ant-oat01-" + "A1b2C3d4E5f6G7h8".repeat(5) + "XyZw01234567890";

/** Exactly the incident: the first 79 characters of a 108-character token. */
const TRUNCATED_TOKEN = FULL_TOKEN.slice(0, 79);

/** Assert a value carries no trace of the secret, however it is serialised. */
function expectNoTokenLeak(value: unknown, token: string): void {
  expect(JSON.stringify(value) ?? "").not.toContain(token);
  expect(String(value)).not.toContain(token);
  if (value instanceof Error) {
    expect(value.message).not.toContain(token);
    expect(value.stack ?? "").not.toContain(token);
  }
}

beforeEach(() => {
  expect(FULL_TOKEN).toHaveLength(108);
  expect(TRUNCATED_TOKEN).toHaveLength(79);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* validateOAuthToken                                                  */
/* ------------------------------------------------------------------ */

describe("validateOAuthToken", () => {
  test("accepts a full-length token", () => {
    expect(validateOAuthToken(FULL_TOKEN)).toEqual({ ok: true });
  });

  test("REJECTS the 79-of-108 truncation that motivated this check", () => {
    const res = validateOAuthToken(TRUNCATED_TOKEN);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    // The reason has to tell a non-technical owner what to DO about it.
    expect(res.reason).toMatch(/cut short/i);
    expect(res.reason).toMatch(/paste it again/i);
  });

  test("rejects anything shorter than a plausible token, right up to the boundary", () => {
    // 89 characters fails, 90 passes: the threshold sits between the 79-char
    // truncation and the 108-char real thing on purpose.
    expect(validateOAuthToken(FULL_TOKEN.slice(0, 89)).ok).toBe(false);
    expect(validateOAuthToken(FULL_TOKEN.slice(0, 90)).ok).toBe(true);
  });

  test("rejects an empty box", () => {
    const res = validateOAuthToken("");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toMatch(/empty/i);
  });

  test("rejects whitespace-only input", () => {
    expect(validateOAuthToken("   \n\t ").ok).toBe(false);
  });

  test("rejects a token broken across two lines by a wrapped terminal", () => {
    const wrapped = FULL_TOKEN.slice(0, 60) + "\n" + FULL_TOKEN.slice(60);
    const res = validateOAuthToken(wrapped);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toMatch(/space or a line break/i);
  });

  test("rejects a space, a tab or a carriage return inside the token", () => {
    for (const gap of [" ", "\t", "\r", "\u000b"]) {
      const broken = FULL_TOKEN.slice(0, 50) + gap + FULL_TOKEN.slice(50);
      expect(validateOAuthToken(broken).ok).toBe(false);
    }
  });

  test("rejects invisible control characters a terminal may paste along", () => {
    const withControl = FULL_TOKEN.slice(0, 40) + "\u0000" + FULL_TOKEN.slice(40);
    expect(validateOAuthToken(withControl).ok).toBe(false);
  });

  test("forgives the newline a paste drags along at either end", () => {
    expect(validateOAuthToken(`\n  ${FULL_TOKEN}\n`)).toEqual({ ok: true });
  });

  test("survives a caller that hands it something that isn't a string", () => {
    // The route parses untrusted JSON; `token: 12345` must not throw here.
    const res = validateOAuthToken(12345 as unknown as string);
    expect(res.ok).toBe(false);
  });

  test("never echoes the token back in the reason", () => {
    expectNoTokenLeak(validateOAuthToken(TRUNCATED_TOKEN), TRUNCATED_TOKEN);
    const wrapped = FULL_TOKEN.slice(0, 60) + "\n" + FULL_TOKEN.slice(60);
    expectNoTokenLeak(validateOAuthToken(wrapped), FULL_TOKEN.slice(0, 60));
  });
});

/* ------------------------------------------------------------------ */
/* verifyOAuthTokenLive                                                */
/* ------------------------------------------------------------------ */

/** Stub global fetch with a canned Response and return the spy. */
function stubFetch(response: Response | Error) {
  const spy = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("verifyOAuthTokenLive", () => {
  test("a 200 means the token works", async () => {
    stubFetch(new Response("{}", { status: 200 }));
    const res = await verifyOAuthTokenLive(FULL_TOKEN);
    expect(res.ok).toBe(true);
    expect(res.inconclusive).toBe(false);
  });

  test("a 401 means Anthropic rejected the token — and says so", async () => {
    stubFetch(new Response("{}", { status: 401 }));
    const res = await verifyOAuthTokenLive(FULL_TOKEN);
    expect(res.ok).toBe(false);
    expect(res.inconclusive).toBe(false);
    expect(res.detail).toMatch(/rejected by Anthropic/i);
  });

  test("a 403 is treated the same way as a 401", async () => {
    stubFetch(new Response("{}", { status: 403 }));
    const res = await verifyOAuthTokenLive(FULL_TOKEN);
    expect(res.ok).toBe(false);
    expect(res.inconclusive).toBe(false);
  });

  test("a 500 is NOT reported as a bad token — the check couldn't run", async () => {
    stubFetch(new Response("boom", { status: 500 }));
    const res = await verifyOAuthTokenLive(FULL_TOKEN);
    expect(res.ok).toBe(false);
    expect(res.inconclusive).toBe(true);
    expect(res.detail).toMatch(/couldn't check/i);
    expect(res.detail).not.toMatch(/rejected/i);
  });

  test("a rate limit is inconclusive too", async () => {
    stubFetch(new Response("slow down", { status: 429 }));
    const res = await verifyOAuthTokenLive(FULL_TOKEN);
    expect(res.inconclusive).toBe(true);
  });

  test("a network failure is inconclusive, not a verdict on the token", async () => {
    stubFetch(new TypeError("fetch failed"));
    const res = await verifyOAuthTokenLive(FULL_TOKEN);
    expect(res.ok).toBe(false);
    expect(res.inconclusive).toBe(true);
    expect(res.detail).toMatch(/couldn't reach anthropic/i);
  });

  test("a timeout is inconclusive", async () => {
    const abort = new Error("The operation was aborted.");
    abort.name = "AbortError";
    stubFetch(abort);
    const res = await verifyOAuthTokenLive(FULL_TOKEN);
    expect(res.inconclusive).toBe(true);
  });

  test("makes exactly ONE minimal call, with the OAuth headers", async () => {
    const spy = stubFetch(new Response("{}", { status: 200 }));
    await verifyOAuthTokenLive(FULL_TOKEN);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${FULL_TOKEN}`);
    expect(headers["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(String(init.body)) as {
      max_tokens: number;
      messages: unknown[];
    };
    expect(body.max_tokens).toBe(1);
    expect(body.messages).toHaveLength(1);
    expect(init.signal).toBeDefined(); // the 10s abort timer
  });

  test("never returns the token in any result", async () => {
    for (const response of [
      new Response("{}", { status: 200 }),
      new Response("{}", { status: 401 }),
      new Response("{}", { status: 500 }),
    ]) {
      stubFetch(response);
      expectNoTokenLeak(await verifyOAuthTokenLive(FULL_TOKEN), FULL_TOKEN);
    }
    stubFetch(new TypeError(`fetch failed for ${FULL_TOKEN}`));
    expectNoTokenLeak(await verifyOAuthTokenLive(FULL_TOKEN), FULL_TOKEN);
  });
});

/* ------------------------------------------------------------------ */
/* setRepoSecret                                                       */
/* ------------------------------------------------------------------ */

/**
 * libsodium, loaded the same way lib/repo-secrets.ts loads it: at runtime,
 * after `ready`. The crypto functions genuinely do not exist on the module
 * object before that, so a static `import * as sodium` is not equivalent.
 */
type TestSodium = {
  ready: Promise<void>;
  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_box_seal_open(
    ciphertext: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Uint8Array;
  from_base64(input: string, variant: number): Uint8Array;
  to_base64(input: Uint8Array, variant: number): string;
  to_string(bytes: Uint8Array): string;
  base64_variants: { ORIGINAL: number };
};

async function loadSodium(): Promise<TestSodium> {
  const mod = await import("libsodium-wrappers");
  const sodium = ((mod as { default?: unknown }).default ?? mod) as unknown as TestSodium;
  await sodium.ready;
  return sodium;
}

type FakeOctokit = {
  rest: {
    actions: {
      getRepoPublicKey: ReturnType<typeof vi.fn>;
      createOrUpdateRepoSecret: ReturnType<typeof vi.fn>;
    };
  };
};

/** Install a fake Octokit whose repo public key we hold the private half of. */
async function stubOctokitWithKeypair(): Promise<{
  octokit: FakeOctokit;
  keypair: { publicKey: Uint8Array; privateKey: Uint8Array };
  sodium: TestSodium;
}> {
  const sodium = await loadSodium();
  const keypair = sodium.crypto_box_keypair();
  const octokit: FakeOctokit = {
    rest: {
      actions: {
        getRepoPublicKey: vi.fn(async () => ({
          data: {
            key: sodium.to_base64(keypair.publicKey, sodium.base64_variants.ORIGINAL),
            key_id: "key-123",
          },
        })),
        createOrUpdateRepoSecret: vi.fn(async () => ({ status: 204 })),
      },
    },
  };
  vi.mocked(getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof getOctokit>);
  return { octokit, keypair, sodium };
}

describe("setRepoSecret", () => {
  test("seals the value so only GitHub's private key can open it", async () => {
    const { octokit, keypair, sodium } = await stubOctokitWithKeypair();

    await setRepoSecret(
      { owner: "acme", repo: "widgets" },
      CLAUDE_OAUTH_SECRET_NAME,
      FULL_TOKEN,
    );

    const put = octokit.rest.actions.createOrUpdateRepoSecret.mock.calls[0][0] as {
      owner: string;
      repo: string;
      secret_name: string;
      encrypted_value: string;
      key_id: string;
    };
    expect(put.owner).toBe("acme");
    expect(put.repo).toBe("widgets");
    expect(put.secret_name).toBe("CLAUDE_CODE_OAUTH_TOKEN");
    expect(put.key_id).toBe("key-123");

    // The plaintext must not be recognisable in what we send...
    expect(put.encrypted_value).not.toContain(FULL_TOKEN);
    // ...and it has to be STANDARD base64, not libsodium's URL-safe default —
    // GitHub decodes it with the standard alphabet at the other end.
    expect(put.encrypted_value).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    // Round-trip proof: GitHub's private key gets the token back out.
    const opened = sodium.crypto_box_seal_open(
      sodium.from_base64(put.encrypted_value, sodium.base64_variants.ORIGINAL),
      keypair.publicKey,
      keypair.privateKey,
    );
    expect(sodium.to_string(opened)).toBe(FULL_TOKEN);
  });

  test("a GitHub failure throws without carrying the token in the error", async () => {
    const { octokit } = await stubOctokitWithKeypair();
    octokit.rest.actions.createOrUpdateRepoSecret.mockRejectedValueOnce(
      new Error("Validation Failed"),
    );

    const err = await setRepoSecret(
      { owner: "acme", repo: "widgets" },
      CLAUDE_OAUTH_SECRET_NAME,
      FULL_TOKEN,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expectNoTokenLeak(err, FULL_TOKEN);
  });
});
