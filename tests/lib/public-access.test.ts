/**
 * The guard rail for public demo mode.
 *
 * The security property this whole feature rests on is one sentence: **an
 * anonymous request never reaches a route handler**. That is enforced in
 * `proxy.ts` by looking every anonymous `/api/*` request up in the demo fixture
 * list and 403-ing a miss. Which means the property holds exactly as long as
 * the fixture list stays honest.
 *
 * So the important test in this file is not any single assertion — it is
 * `describe("the anonymous API surface")`, which walks `app/api/**` on disk,
 * works out every (path, method) pair the app actually exposes, and asserts
 * that the anonymous-reachable subset is EXACTLY the list written down below.
 * Add a route tomorrow and it is unreachable by default; expose one on purpose
 * and this test fails until you say so here, in a diff a human reads.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_FIXTURES, findDemoFixture } from "../../lib/demo/api-fixtures";
import {
  isAlwaysPublic,
  isAuthSensitivePath,
  isStaticAssetPath,
  readCookie,
} from "../../lib/public-access";
import { clientKey, rateLimit, resetRateLimits } from "../../lib/rate-limit";
import { buildCsp, securityHeaders } from "../../lib/security-headers";
import { contentTypeFor, evidenceRendersInline } from "../../lib/queues-evidence";

// fileURLToPath, not `.pathname` — the repo path contains a space, which a
// file: URL percent-encodes. See the same note in vitest.config.mts.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API_ROOT = path.join(REPO_ROOT, "app/api");

/* ------------------------------------------------------------------ */
/* Route discovery                                                     */
/* ------------------------------------------------------------------ */

type DiscoveredRoute = {
  /** URL path with dynamic segments filled in, e.g. /api/builds/123. */
  urlPath: string;
  /** Source path with the brackets intact, for readable failure messages. */
  sourcePath: string;
  methods: string[];
};

/** Concrete stand-ins for dynamic segments, so a fixture RegExp can be tested. */
function fillSegment(segment: string): string {
  if (segment.startsWith("[...")) return "sample/file.png";
  if (!segment.startsWith("[")) return segment;
  const name = segment.slice(1, -1);
  // Numeric-looking params get a number: several fixtures anchor on \d+, and a
  // word there would make this test pass for the wrong reason.
  if (["pr", "number", "id"].includes(name)) return "123";
  return "sample";
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function discoverRoutes(): DiscoveredRoute[] {
  return walk(API_ROOT).map((file) => {
    const rel = path.relative(REPO_ROOT, file).replace(/\/route\.ts$/, "");
    const segments = rel.replace(/^app/, "").split("/").filter(Boolean);
    const source = "/" + segments.join("/");
    const url = "/" + segments.map(fillSegment).join("/");
    const src = readFileSync(file, "utf8");
    const methods = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s*\(/g)].map(
      (m) => m[1]!,
    );
    return { urlPath: url, sourcePath: source, methods };
  });
}

const ROUTES = discoverRoutes();

/* ------------------------------------------------------------------ */
/* The list a human has to change on purpose                           */
/* ------------------------------------------------------------------ */

/**
 * Every (path, method) an anonymous visitor can get a non-403 out of.
 *
 * Two kinds of entry:
 *   - `always-public`: the handler really runs. Only three, all audited:
 *     the container health check and the two ends of the login gate.
 *   - `demo`: the proxy answers from a frozen fixture and the handler does not
 *     run. Read-only by construction — a fixture cannot merge a PR.
 *
 * Nothing else may appear here without a reason written next to it.
 */
const EXPECTED_ANONYMOUS_SURFACE: Record<string, "always-public" | "demo"> = {
  // Handler runs.
  "GET /api/health": "always-public",
  "POST /api/login": "always-public",
  "POST /api/logout": "always-public",

  // Answered from the snapshot; handler never runs.
  "GET /api/map/projects": "demo",
  "GET /api/map/status": "demo",
  "GET /api/map/agent/123": "demo",
  "GET /api/map/history": "demo",
  "GET /api/map/history/sample": "demo",
  "GET /api/map/power": "demo",
  "GET /api/map/template": "demo",
  "GET /api/map/template/drift": "demo",
  "GET /api/map/projects/checklist": "demo",
  "GET /api/launch/status": "demo",
  "GET /api/ideas": "demo",
  "GET /api/ideas/123": "demo",
  "GET /api/builds": "demo",
  "GET /api/builds/123": "demo",
  "GET /api/learnings": "demo",
  "GET /api/loop-config": "demo",
  "GET /api/reporter": "demo",
  "GET /api/tools/catalog": "demo",
  "GET /api/tools/activity": "demo",
  "GET /api/tools/needs-you": "demo",
  "GET /api/tools/install": "demo",
  "GET /api/tools/fit/repos": "demo",
  "GET /api/testing/dispatch-options": "demo",
  "GET /api/testing/instructions": "demo",
  "GET /api/testing/runs": "demo",
  "GET /api/testing/test-suite": "demo",
  "GET /api/testing/metrics-compare": "demo",
  "GET /api/testing/commit-diff": "demo",
};

/** What the proxy would do with an anonymous request, in demo mode. */
function anonymousOutcome(urlPath: string, method: string): "always-public" | "demo" | "denied" {
  if (isAlwaysPublic(urlPath, method)) return "always-public";
  if (findDemoFixture(urlPath, method)) return "demo";
  return "denied";
}

describe("the anonymous API surface", () => {
  it("finds every route on disk", () => {
    // A sanity check on the walker itself: if the discovery silently returned
    // nothing, every other assertion in this file would pass vacuously.
    expect(ROUTES.length).toBeGreaterThan(60);
    expect(ROUTES.every((r) => r.methods.length > 0)).toBe(true);
  });

  it("is exactly the list written down in this file", () => {
    const actual: Record<string, string> = {};
    for (const route of ROUTES) {
      for (const method of route.methods) {
        const outcome = anonymousOutcome(route.urlPath, method);
        if (outcome !== "denied") actual[`${method} ${route.urlPath}`] = outcome;
      }
    }
    expect(actual).toEqual(EXPECTED_ANONYMOUS_SURFACE);
  });

  it("denies every mutating method on every route", () => {
    const reachable: string[] = [];
    for (const route of ROUTES) {
      for (const method of route.methods) {
        if (method === "GET" || method === "HEAD") continue;
        // /api/login and /api/logout are the login gate; they mutate nothing an
        // anonymous caller does not already control (their own cookie).
        if (route.sourcePath === "/api/login" || route.sourcePath === "/api/logout") continue;
        if (anonymousOutcome(route.urlPath, method) !== "denied") {
          reachable.push(`${method} ${route.sourcePath}`);
        }
      }
    }
    expect(reachable).toEqual([]);
  });

  it("never lets a fixture answer a POST/PATCH/PUT/DELETE", () => {
    // Belt and braces on the fixture files themselves: a fixture that forgot to
    // narrow `methods` would let a mutation through with a 200 body, which the
    // UI would treat as success.
    for (const route of ROUTES) {
      for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
        expect(findDemoFixture(route.urlPath, method)).toBeNull();
      }
    }
  });

  it("blocks every route the audit flagged as LLM spend", () => {
    // Named individually rather than derived, because "an anonymous visitor can
    // spend money on Bedrock" is the single most expensive way this can fail.
    const llmRoutes = [
      "/api/assistant",
      "/api/builds/123/chat",
      "/api/ideas/123/chat",
      "/api/ideas/custom/ai",
      "/api/ideas/custom/chat",
      "/api/launch/analyze",
      "/api/map/agent/123/draft",
      "/api/map/loop-edit",
      "/api/map/process-chat",
      "/api/reporter/refresh",
      "/api/reporter/summarize",
      "/api/reporter/cron",
      "/api/tools/catalog/refresh",
      "/api/tools/fit",
    ];
    for (const route of llmRoutes) {
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        expect(anonymousOutcome(route, method)).toBe("denied");
      }
    }
  });

  it("blocks the launcher and local-filesystem routes", () => {
    // These are 404 in the cloud anyway (LOOP_DASHBOARD_LOCAL_MODE is unset),
    // but they leak absolute filesystem paths if that ever changes.
    for (const route of ["/api/projects/local-scan", "/api/projects/local-init", "/api/launch/run", "/api/launch/analyze/123"]) {
      for (const method of ["GET", "POST"]) {
        expect(anonymousOutcome(route, method)).toBe("denied");
      }
    }
  });

  it("blocks the evidence streamer, including the .png bypass it once had", () => {
    // Appending an image extension to this path used to skip the proxy entirely
    // because the exemption lived in the matcher regex. Both halves are checked:
    // the classifier must not call it a static asset, and it must not be
    // anonymously reachable.
    const evidence = "/api/builds/evidence/123/shot.png";
    expect(isStaticAssetPath(evidence)).toBe(false);
    expect(anonymousOutcome(evidence, "GET")).toBe("denied");
  });
});

describe("fixtures", () => {
  const url = new URL("https://example.test/api/x?project=aurora-notes");

  it("anchor every RegExp match", () => {
    // An unanchored pattern like /\/api\/ideas\/\d+/ also matches
    // /api/ideas/123/chat — an LLM route — and would hand it a 200.
    for (const fixture of DEMO_FIXTURES) {
      if (typeof fixture.match === "string") continue;
      expect(fixture.match.source.startsWith("^")).toBe(true);
      expect(fixture.match.source.endsWith("$")).toBe(true);
    }
  });

  it("serialise to JSON without throwing", () => {
    // The proxy calls NextResponse.json() on these. A Map, a Set, a Date or a
    // circular reference in a fixture would become a 500 in production and
    // nowhere else.
    for (const fixture of DEMO_FIXTURES) {
      expect(() => JSON.stringify(fixture.body(url))).not.toThrow();
    }
  });

  it("contain nothing that looks like a credential or a local path", () => {
    const serialised = DEMO_FIXTURES.map((f) => JSON.stringify(f.body(url))).join("\n");
    for (const pattern of [/gh[pousr]_[A-Za-z0-9]{16,}/, /sk-ant-/, /AKIA[0-9A-Z]{16}/, /SESSION_SECRET/, /\/Users\//, /\/home\/[a-z]/]) {
      expect(serialised).not.toMatch(pattern);
    }
    // The owner's real GitHub handle must not appear in demo content either.
    expect(serialised).not.toMatch(/ApagPlayz/);
  });
});

/* ------------------------------------------------------------------ */
/* Smaller units                                                       */
/* ------------------------------------------------------------------ */

describe("readCookie", () => {
  it("pulls out the named cookie and ignores prefixes of it", () => {
    const header = "other=1; loop_dash_session=abc.def; loop_dash_session_x=nope";
    expect(readCookie(header, "loop_dash_session")).toBe("abc.def");
  });

  it("returns undefined for a missing cookie or a missing header", () => {
    expect(readCookie("a=1", "loop_dash_session")).toBeUndefined();
    expect(readCookie(null, "loop_dash_session")).toBeUndefined();
    expect(readCookie(undefined, "loop_dash_session")).toBeUndefined();
  });
});

describe("isAlwaysPublic", () => {
  it("allows only the three audited paths, and only their real methods", () => {
    expect(isAlwaysPublic("/api/health", "GET")).toBe(true);
    expect(isAlwaysPublic("/api/login", "POST")).toBe(true);
    expect(isAlwaysPublic("/api/logout", "POST")).toBe(true);
    // Wrong method on a public path is not public.
    expect(isAlwaysPublic("/api/health", "POST")).toBe(false);
    expect(isAlwaysPublic("/api/login", "GET")).toBe(false);
    // Prefix games.
    expect(isAlwaysPublic("/api/health/../ideas", "GET")).toBe(false);
    expect(isAlwaysPublic("/api/healthz", "GET")).toBe(false);
  });
});

describe("isStaticAssetPath", () => {
  it("exempts real assets but never anything under /api/", () => {
    expect(isStaticAssetPath("/logo.svg")).toBe(true);
    expect(isStaticAssetPath("/fonts/inter.woff2")).toBe(true);
    expect(isStaticAssetPath("/api/anything.png")).toBe(false);
    expect(isStaticAssetPath("/api/builds/evidence/1/x.jpg")).toBe(false);
    expect(isStaticAssetPath("/ideas")).toBe(false);
  });
});

describe("isAuthSensitivePath", () => {
  it("covers both ends of the session lifecycle", () => {
    expect(isAuthSensitivePath("/api/login")).toBe(true);
    expect(isAuthSensitivePath("/api/logout")).toBe(true);
    expect(isAuthSensitivePath("/api/ideas")).toBe(false);
  });
});

describe("buildCsp", () => {
  const csp = buildCsp({ nonce: "TESTNONCE", isDev: false });

  it("binds scripts to the nonce and nothing else", () => {
    expect(csp).toContain("script-src 'self' 'nonce-TESTNONCE' 'strict-dynamic'");
    // The whole point: an injected inline <script> must not run.
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("closes the classic injection escapes", () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  it("allows unsafe-inline for styles only, and says so", () => {
    // Inline style ATTRIBUTES cannot carry a nonce, and the process map
    // positions every node with one.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("adds unsafe-eval only in development", () => {
    expect(buildCsp({ nonce: "N", isDev: true })).toContain("'unsafe-eval'");
  });
});

describe("securityHeaders", () => {
  it("sets the headers the audit asked for", () => {
    const headers = securityHeaders({ isDev: false });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
  });

  it("omits HSTS in development so localhost is not pinned to HTTPS", () => {
    expect(securityHeaders({ isDev: true })["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("evidence content types", () => {
  it("never serves an SVG as image/svg+xml", () => {
    // An SVG is an XML document: served with that type from our own origin, any
    // <script> inside it runs as us. This is the stored-XSS hole the audit found.
    expect(contentTypeFor("diagram.svg")).toBe("application/octet-stream");
    expect(contentTypeFor("nested/path/diagram.SVG")).toBe("application/octet-stream");
  });

  it("still serves the media the demo evidence actually contains", () => {
    expect(contentTypeFor("01-shot.png")).toBe("image/png");
    expect(contentTypeFor("video/01-demo.webm")).toBe("video/webm");
  });

  it("marks only media as inline-renderable", () => {
    expect(evidenceRendersInline("image/png")).toBe(true);
    expect(evidenceRendersInline("video/webm")).toBe(true);
    expect(evidenceRendersInline("application/octet-stream")).toBe(false);
    expect(evidenceRendersInline("text/plain; charset=utf-8")).toBe(false);
  });
});

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit and then refuses", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", 3, 60_000, now).ok).toBe(true);
    }
    const blocked = rateLimit("k", 3, 60_000, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("starts a fresh window once the old one expires", () => {
    const now = 1_000_000;
    rateLimit("k", 1, 60_000, now);
    expect(rateLimit("k", 1, 60_000, now).ok).toBe(false);
    expect(rateLimit("k", 1, 60_000, now + 60_001).ok).toBe(true);
  });

  it("keys are independent", () => {
    const now = 1_000_000;
    rateLimit("a", 1, 60_000, now);
    expect(rateLimit("b", 1, 60_000, now).ok).toBe(true);
  });
});

describe("clientKey", () => {
  it("prefers the CloudFront-set viewer address, port stripped", () => {
    const headers = new Headers({
      "cloudfront-viewer-address": "203.0.113.7:53412",
      "x-forwarded-for": "1.1.1.1",
    });
    expect(clientKey(headers)).toBe("203.0.113.7");
  });

  it("handles a bracketed IPv6 viewer address", () => {
    const headers = new Headers({ "cloudfront-viewer-address": "[2001:db8::1]:443" });
    expect(clientKey(headers)).toBe("2001:db8::1");
  });

  it("takes the LAST x-forwarded-for entry, which is the one CloudFront appended", () => {
    // The client controls every earlier entry. Taking the first would let a
    // visitor pick their own rate-limit bucket on every request.
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.7" });
    expect(clientKey(headers)).toBe("203.0.113.7");
  });

  it("falls back to a constant rather than to no limiting at all", () => {
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
