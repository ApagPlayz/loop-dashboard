/**
 * Public demo mode — who may see what without logging in.
 *
 * ## Why this exists
 *
 * The dashboard is a single-owner control room whose data is issue and PR text
 * from PRIVATE repositories, and whose API can merge PRs, dispatch workflows and
 * spend money on Bedrock. Recruiters and friends should still be able to click a
 * link and see it working. Those two facts are only compatible under one rule:
 *
 *   **An anonymous request never reaches a route handler.**
 *
 * An audit of all 68 routes under `app/api/**` found exactly three that are safe
 * to *execute* for an anonymous caller (`/api/health`, `/api/login`,
 * `/api/logout`). Every other route reads live private GitHub data, calls a paid
 * model, touches the filesystem, or writes something. So rather than trying to
 * make sixty-five handlers individually safe — a check that has to be right
 * sixty-five times, and again for every route added later — the proxy answers
 * anonymous API reads itself, out of a frozen snapshot, and refuses everything
 * else. There is no "I forgot to add the guard to my new route" failure mode:
 * a route with no snapshot entry is simply unreachable.
 *
 * ## The three layers
 *
 * 1. `proxy.ts` — deny by default. Anonymous `/api/*` requests are answered from
 *    `lib/demo/api-fixtures.ts` or refused with 403. No handler runs.
 * 2. `lib/projects.ts` — `listProjects()` returns the SYNTHETIC registry for an
 *    anonymous viewer, so every repo-scoped call a server component makes points
 *    at a repo that does not exist. Even if a `GITHUB_TOKEN` is added later and
 *    some page path is missed, there is no private repo for it to read.
 * 3. The server components that render public pages branch to demo fixtures
 *    directly, so the pages have content rather than error states.
 *
 * ## The owner is unaffected
 *
 * Everything here is keyed off "is there a valid session cookie". With one, the
 * app behaves exactly as it did before this file existed — live GitHub, live AI,
 * every mutation available. Demo mode is a *fallback for the unauthenticated*,
 * not a mode the app is switched into.
 */

import { AUTH_COOKIE, verifyAuthCookie } from "@/lib/auth";

/* ------------------------------------------------------------------ */
/* Switch                                                              */
/* ------------------------------------------------------------------ */

/**
 * Off unless explicitly enabled, so a fresh clone, a local `next dev`, and any
 * other deployment keep the password gate they had. The public deployment sets
 * `LOOP_DASHBOARD_PUBLIC_DEMO=1` in infra/task-definition.json.
 */
export function publicDemoEnabled(): boolean {
  return (process.env.LOOP_DASHBOARD_PUBLIC_DEMO ?? "").trim() === "1";
}

/* ------------------------------------------------------------------ */
/* Cookie reading                                                      */
/* ------------------------------------------------------------------ */

/**
 * Pull one cookie out of a raw `Cookie` header.
 *
 * Written by hand rather than reached for via `NextRequest.cookies` so this
 * module stays importable from plain unit tests and from anything that only has
 * a `Request`.
 */
export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** True when the request carries a valid, unexpired, correctly-signed session. */
export async function isOwnerRequest(req: Request): Promise<boolean> {
  const token = readCookie(req.headers.get("cookie"), AUTH_COOKIE);
  return verifyAuthCookie(token);
}

/* ------------------------------------------------------------------ */
/* Path classification                                                 */
/* ------------------------------------------------------------------ */

/**
 * Reachable without a session in EVERY mode, demo or not.
 *
 * - `/api/health` is the ECS container health-check target. Behind auth the
 *   check gets a 401 and the task is marked permanently unhealthy.
 * - `/api/login` is the gate itself. It is rate-limited hard in the proxy —
 *   a publicly-reachable password form is a brute-force target in a way a
 *   private one never was.
 * - `/api/logout` only clears a cookie.
 */
const ALWAYS_PUBLIC_API: Record<string, readonly string[]> = {
  "/api/health": ["GET", "HEAD"],
  "/api/login": ["POST"],
  "/api/logout": ["POST"],
};

/**
 * Static files under /public that may be served without a session.
 *
 * Deliberately NOT applied to `/api/` — an API route is dynamic code no matter
 * what its URL ends in, and several take a caller-supplied trailing path
 * segment. This check used to live in the proxy's matcher regex, which let ANY
 * path ending in an image extension skip the proxy entirely, including
 * `/api/builds/evidence/<pr>/<...file>`: appending ".png" made that route fully
 * unauthenticated. Keep `/api/` excluded first.
 */
const STATIC_ASSET = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|map)$/i;

export function isStaticAssetPath(pathname: string): boolean {
  return !pathname.startsWith("/api/") && STATIC_ASSET.test(pathname);
}

export function isAlwaysPublic(pathname: string, method: string): boolean {
  const methods = ALWAYS_PUBLIC_API[pathname];
  return methods !== undefined && methods.includes(method.toUpperCase());
}

/** Paths whose responses must never be cached by CloudFront or a browser. */
export function isAuthSensitivePath(pathname: string): boolean {
  return pathname === "/api/login" || pathname === "/api/logout";
}

/* ------------------------------------------------------------------ */
/* Rate limits                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ceilings for anonymous traffic. The demo answers come out of a frozen object
 * in memory, so these are not about protecting a backend — they are about
 * making the public link uninteresting as a login-brute-force or scraping
 * target, and about capping the CloudFront bill.
 */
export const ANON_PAGE_LIMIT = 240; // per IP per minute
export const ANON_PAGE_WINDOW_MS = 60_000;

export const ANON_API_LIMIT = 300; // per IP per minute
export const ANON_API_WINDOW_MS = 60_000;

/**
 * Deliberately tight. A correct password gets in on the first try; nobody
 * legitimately needs a 21st attempt in a quarter of an hour.
 */
export const LOGIN_LIMIT = 20;
export const LOGIN_WINDOW_MS = 15 * 60_000;
