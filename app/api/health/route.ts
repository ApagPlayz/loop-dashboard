import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health — unauthenticated liveness check for the ALB/ECS target
 * group (and for `docker run` smoke tests). Deliberately excluded from auth
 * in proxy.ts: without that exclusion the health check would hit a
 * protected path, get redirected to /login, and the ECS target would be
 * marked permanently unhealthy. Keep this route free of any dependency on
 * GitHub, the project registry, or auth state — it must return 200 the
 * moment the process is up.
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}
