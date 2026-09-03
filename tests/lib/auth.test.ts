import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  COOKIE_MAX_AGE,
  createAuthCookie,
  verifyAuthCookie,
  verifyPassword,
  viewerProtocol,
} from "../../lib/auth";

/**
 * Only these three env vars affect auth.ts behaviour. Snapshot + restore them
 * around every test so tests can't leak state into each other.
 */
const ENV_KEYS = ["DASHBOARD_PASSWORD", "SESSION_SECRET", "SESSION_KEY_VERSION"] as const;
let originalEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as typeof originalEnv;
  process.env.DASHBOARD_PASSWORD = "correct-horse-battery-staple";
  process.env.SESSION_SECRET = "unit-test-session-secret-do-not-use-in-prod";
  delete process.env.SESSION_KEY_VERSION;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createAuthCookie / verifyAuthCookie round-trip", () => {
  test("a cookie created by the sign path verifies successfully", async () => {
    const cookie = await createAuthCookie();
    expect(cookie).toMatch(/^[^.]+\.[^.]+$/);
    expect(await verifyAuthCookie(cookie)).toBe(true);
  });

  test("COOKIE_MAX_AGE is documented as 30 days, in seconds", () => {
    expect(COOKIE_MAX_AGE).toBe(30 * 24 * 60 * 60);
  });
});

describe("tamper detection", () => {
  test("flipping a character in the payload segment is rejected", async () => {
    const cookie = await createAuthCookie();
    const [payload, signature] = cookie.split(".");
    const idx = 0;
    const flipped =
      payload[idx] === "A" ? "B" + payload.slice(1) : "A" + payload.slice(1);
    const tampered = `${flipped}.${signature}`;
    expect(await verifyAuthCookie(tampered)).toBe(false);
  });

  test("flipping a character in the signature segment is rejected", async () => {
    const cookie = await createAuthCookie();
    const [payload, signature] = cookie.split(".");
    const idx = 0;
    const flipped =
      signature[idx] === "A" ? "B" + signature.slice(1) : "A" + signature.slice(1);
    const tampered = `${payload}.${flipped}`;
    expect(await verifyAuthCookie(tampered)).toBe(false);
  });
});

describe("malformed cookie shapes", () => {
  test("no dot separator is rejected", async () => {
    expect(await verifyAuthCookie("nodotseparatorhere")).toBe(false);
  });

  test("empty string is rejected", async () => {
    expect(await verifyAuthCookie("")).toBe(false);
  });

  test("null and undefined are rejected", async () => {
    expect(await verifyAuthCookie(null)).toBe(false);
    expect(await verifyAuthCookie(undefined)).toBe(false);
  });

  test("extra segments (more than one dot) are rejected", async () => {
    expect(await verifyAuthCookie("payload.signature.extra")).toBe(false);
  });

  test("non-base64url junk with a mismatched-length signature is rejected without throwing", async () => {
    await expect(verifyAuthCookie("!!!not-base64!!!.###also-junk###")).resolves.toBe(false);
  });
});

describe("expiry", () => {
  test("an expired session is rejected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cookie = await createAuthCookie();
    // Jump past the 30-day expiry baked into the payload.
    vi.setSystemTime(new Date(Date.now() + (COOKIE_MAX_AGE + 60) * 1000));
    expect(await verifyAuthCookie(cookie)).toBe(false);
  });

  test("a session just before expiry is still accepted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cookie = await createAuthCookie();
    vi.setSystemTime(new Date(Date.now() + (COOKIE_MAX_AGE - 60) * 1000));
    expect(await verifyAuthCookie(cookie)).toBe(true);
  });
});

describe("SESSION_KEY_VERSION", () => {
  test("bumping the key version invalidates a previously-valid cookie", async () => {
    const cookie = await createAuthCookie();
    expect(await verifyAuthCookie(cookie)).toBe(true);

    process.env.SESSION_KEY_VERSION = "2";
    expect(await verifyAuthCookie(cookie)).toBe(false);
  });
});

describe("verifyPassword", () => {
  test("the correct password passes", () => {
    expect(verifyPassword("correct-horse-battery-staple")).toBe(true);
  });

  test("a wrong password of the same length fails", () => {
    const correct = "correct-horse-battery-staple";
    // Same length by construction: swap the last character for a different one.
    const wrongSameLength = correct.slice(0, -1) + (correct.at(-1) === "!" ? "?" : "!");
    expect(wrongSameLength.length).toBe(correct.length);
    expect(verifyPassword(wrongSameLength)).toBe(false);
  });

  test("a wrong password of a different length fails cleanly without throwing", () => {
    expect(() => verifyPassword("short")).not.toThrow();
    expect(verifyPassword("short")).toBe(false);

    expect(() => verifyPassword("a-much-much-much-longer-wrong-password-than-the-real-one")).not.toThrow();
    expect(verifyPassword("a-much-much-much-longer-wrong-password-than-the-real-one")).toBe(false);
  });

  test("an empty password fails without throwing", () => {
    expect(() => verifyPassword("")).not.toThrow();
    expect(verifyPassword("")).toBe(false);
  });
});

describe("SESSION_SECRET fallback", () => {
  test("falls back to signing with DASHBOARD_PASSWORD when SESSION_SECRET is unset, warning once", async () => {
    // The "warned once" flag lives in module-level state, so load a fresh
    // copy of the module to observe the warning from a clean slate.
    vi.resetModules();
    delete process.env.SESSION_SECRET;
    process.env.DASHBOARD_PASSWORD = "fallback-only-password";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const freshAuth = await import("../../lib/auth");

    const cookie = await freshAuth.createAuthCookie();
    expect(await freshAuth.verifyAuthCookie(cookie)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("SESSION_SECRET is not set");

    // A second call must not warn again — it's a one-time warning.
    await freshAuth.createAuthCookie();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("a cookie signed under the fallback still verifies through the same code path", async () => {
    vi.resetModules();
    delete process.env.SESSION_SECRET;
    process.env.DASHBOARD_PASSWORD = "another-fallback-password";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const freshAuth = await import("../../lib/auth");
    const cookie = await freshAuth.createAuthCookie();

    // Changing the password after the fact invalidates the fallback-signed
    // cookie too, since the password doubles as the HMAC key in this mode.
    process.env.DASHBOARD_PASSWORD = "a-different-password-entirely";
    expect(await freshAuth.verifyAuthCookie(cookie)).toBe(false);
  });
});

describe("viewerProtocol", () => {
  const req = (headers: Record<string, string>, url = "http://10.0.0.5:3000/api/login") =>
    new Request(url, { headers });

  test("falls back to the request's own scheme when nothing is in front", () => {
    expect(viewerProtocol(req({}))).toBe("http");
    expect(viewerProtocol(req({}, "https://example.com/api/login"))).toBe("https");
  });

  test("honours x-forwarded-proto from a normal reverse proxy", () => {
    expect(viewerProtocol(req({ "x-forwarded-proto": "https" }))).toBe("https");
  });

  /**
   * The regression that broke the AWS deploy twice. Next.js's standalone server
   * defaults x-forwarded-proto to the scheme of its own socket, so behind
   * CloudFront that header is ALWAYS present and ALWAYS "http". Checking it
   * first means cloudfront-forwarded-proto is never reached and the session
   * cookie silently loses its Secure flag on a TLS connection.
   */
  test("cloudfront-forwarded-proto wins over a self-assigned x-forwarded-proto", () => {
    expect(
      viewerProtocol(
        req({ "x-forwarded-proto": "http", "cloudfront-forwarded-proto": "https" }),
      ),
    ).toBe("https");
  });

  test("reads the client-facing hop from a proxy chain", () => {
    expect(viewerProtocol(req({ "x-forwarded-proto": "https, http" }))).toBe("https");
    expect(viewerProtocol(req({ "x-forwarded-proto": "HTTPS" }))).toBe("https");
  });

  test("does not invent https when the viewer really was on http", () => {
    expect(viewerProtocol(req({ "cloudfront-forwarded-proto": "http" }))).toBe("http");
  });
});
