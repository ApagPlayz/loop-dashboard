import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyAuthCookie } from "@/lib/auth";

/**
 * Protects every page and API route except the login flow. In Next.js 16 this
 * is "Proxy" (formerly Middleware) and runs on the Node.js runtime.
 * Unauthenticated page requests redirect to /login; unauthenticated API
 * requests get a 401 JSON response.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always-public paths.
  // /api/health is unauthenticated on purpose: it's the ALB/ECS health
  // check target. Without this, the health check hits a protected path,
  // gets redirected to /login, and the target is marked permanently
  // unhealthy. See docs/plans/aws-bedrock-multitenant-plan-2026-08-31.md §2.2.
  if (pathname === "/login" || pathname === "/api/login" || pathname === "/api/health") {
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (await verifyAuthCookie(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
