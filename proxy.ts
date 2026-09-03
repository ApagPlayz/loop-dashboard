import { NextRequest, NextResponse } from "next/server";

import { findDemoFixture } from "@/lib/demo/api-fixtures";
import {
  ANON_API_LIMIT,
  ANON_API_WINDOW_MS,
  ANON_PAGE_LIMIT,
  ANON_PAGE_WINDOW_MS,
  LOGIN_LIMIT,
  LOGIN_WINDOW_MS,
  isAlwaysPublic,
  isAuthSensitivePath,
  isOwnerRequest,
  isStaticAssetPath,
  publicDemoEnabled,
} from "@/lib/public-access";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { buildCsp, securityHeaders } from "@/lib/security-headers";

/**
 * The single gate in front of every page and API route. In Next.js 16 this is
 * "Proxy" (formerly Middleware) and runs on the Node.js runtime.
 *
 * It does three jobs, in this order:
 *
 *   1. Decides WHO is asking — owner (valid session cookie) or anonymous.
 *   2. Decides what they may have. The owner gets everything, exactly as before.
 *      An anonymous visitor gets pages, plus API reads answered from a frozen
 *      demo snapshot, and a 403 for everything else. **No route handler ever
 *      runs for an anonymous request** — see lib/public-access.ts for why that
 *      is the rule rather than per-route guards.
 *   3. Stamps security headers, including a per-request CSP nonce, on the way
 *      out.
 *
 * With `LOOP_DASHBOARD_PUBLIC_DEMO` unset — every environment except the public
 * deployment — step 2 collapses back to the original behaviour: log in or go
 * away. Nothing about the owner's experience changes in either case.
 */

/** Nonce for this request's CSP. Must be unpredictable and used exactly once. */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Apply the standard headers to a response. `csp` is threaded through rather
 * than recomputed so the header on the response is byte-identical to the one on
 * the request — Next extracts the nonce from the request copy, and a mismatch
 * would nonce the markup with a value the browser is not honouring.
 */
function harden(res: NextResponse, csp: string | null, pathname: string): NextResponse {
  for (const [key, value] of Object.entries(securityHeaders({ isDev: IS_DEV }))) {
    res.headers.set(key, value);
  }
  if (csp) res.headers.set("Content-Security-Policy", csp);
  // Never let a shared cache hold a login or logout response: they carry
  // Set-Cookie, and CloudFront serving one visitor's session cookie to another
  // is the worst possible outcome of a caching mistake.
  if (isAuthSensitivePath(pathname)) {
    res.headers.set("Cache-Control", "no-store, max-age=0");
  }
  return res;
}

function denied(status: number, message: string, csp: string, pathname: string) {
  return harden(
    NextResponse.json({ error: message }, { status }),
    csp,
    pathname,
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();
  const nonce = makeNonce();
  const csp = buildCsp({ nonce, isDev: IS_DEV });

  /** Pass the request through, giving Next the nonce it needs to stamp markup. */
  const passThrough = () => {
    const requestHeaders = new Headers(req.headers);
    // Overwrite, never merge: a client that sends its own
    // Content-Security-Policy request header must not get to choose the nonce.
    requestHeaders.set("Content-Security-Policy", csp);
    requestHeaders.set("x-nonce", nonce);
    return harden(
      NextResponse.next({ request: { headers: requestHeaders } }),
      csp,
      pathname,
    );
  };

  // Real static files under /public bypass auth; API routes never do. This
  // check cannot live in the matcher regex, because a regex cannot express
  // "…but not under /api/" safely — and it once didn't, which made
  // /api/builds/evidence/<pr>/<caller-controlled>.png fully unauthenticated.
  if (isStaticAssetPath(pathname)) {
    return harden(NextResponse.next(), null, pathname);
  }

  // Reachable with or without a session, in every mode.
  //   /api/health — the ECS container health check. Behind auth it 401s and the
  //     task is marked permanently unhealthy.
  //   /api/login, /api/logout — the gate itself.
  if (isAlwaysPublic(pathname, method)) {
    if (pathname === "/api/login") {
      // A password form that anyone can now reach is a brute-force target in a
      // way a private one never was. Twenty attempts per quarter hour per IP.
      const limit = rateLimit(
        `login:${clientKey(req.headers)}`,
        LOGIN_LIMIT,
        LOGIN_WINDOW_MS,
      );
      if (!limit.ok) {
        const res = denied(429, "Too many sign-in attempts. Try again shortly.", csp, pathname);
        res.headers.set("Retry-After", String(limit.retryAfterSeconds));
        return res;
      }
    }
    return passThrough();
  }

  // The login screen itself must always render.
  if (pathname === "/login") return passThrough();

  if (await isOwnerRequest(req)) return passThrough();

  /* ---- anonymous from here down ---- */

  if (!publicDemoEnabled()) {
    if (pathname.startsWith("/api/")) {
      return denied(401, "unauthorized", csp, pathname);
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return harden(NextResponse.redirect(url), csp, pathname);
  }

  const ip = clientKey(req.headers);
  const isApi = pathname.startsWith("/api/");
  const limit = rateLimit(
    `anon:${isApi ? "api" : "page"}:${ip}`,
    isApi ? ANON_API_LIMIT : ANON_PAGE_LIMIT,
    isApi ? ANON_API_WINDOW_MS : ANON_PAGE_WINDOW_MS,
  );
  if (!limit.ok) {
    const res = denied(429, "Rate limit exceeded.", csp, pathname);
    res.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return res;
  }

  if (isApi) {
    const fixture = findDemoFixture(pathname, method);
    if (!fixture) {
      // Deliberately identical for "route does not exist", "route exists but
      // mutates", and "route exists but this method mutates". A public visitor
      // learns nothing about the API surface from probing it.
      return denied(
        403,
        "This dashboard is in read-only demo mode. Sign in to use live data.",
        csp,
        pathname,
      );
    }
    const res = NextResponse.json(fixture.body(new URL(req.url)), {
      status: 200,
      headers: {
        // The snapshot is frozen, but it is still per-viewer state as far as
        // CloudFront is concerned; keep it out of shared caches so a future
        // change to the cache policy cannot leak an owner response into it.
        "Cache-Control": "no-store, max-age=0",
        "X-Loop-Demo": "snapshot",
      },
    });
    return harden(res, csp, pathname);
  }

  // Pages render for anonymous visitors. Their server components branch to the
  // demo snapshot themselves (see lib/demo/viewer.ts), and listProjects()
  // returns the synthetic registry, so nothing they can touch points at a real
  // repository.
  return passThrough();
}

export const config = {
  // Run on everything except Next's own build output. Asset exemptions are
  // decided in proxy() above, where /api/ can be excluded first — a matcher
  // regex cannot express that safely.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
