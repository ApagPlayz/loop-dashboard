import { NextResponse } from "next/server";

import { getRecentUsage, summarizeUsage } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/usage — token and list-price accounting for every AI call this
 * process has made, totalled and broken down by feature label, model and
 * backend.
 *
 * ## Private, by the proxy's default
 *
 * There is no auth check in this handler, and that is correct: proxy.ts denies
 * every anonymous `/api/*` request that is not in `ALWAYS_PUBLIC_API` and does
 * not have a demo fixture, before any handler runs (see lib/public-access.ts).
 * A new route is private the moment it exists. What this route must NEVER get
 * is an `ALWAYS_PUBLIC_API` entry or an entry in lib/demo/api-fixtures.ts —
 * spend shape is a decent proxy for what the owner has been working on, and
 * this is an internal number, not a demo one. tests/lib/ai-usage.test.ts
 * asserts both.
 *
 * ## Scope
 *
 * This reads the in-process ring in lib/ai-usage.ts, so it answers for THIS
 * server process — restart it and the numbers start again from zero. The
 * durable history is the JSONL file lib/usage-store.ts appends to; a
 * longer-horizon view reads that instead, and is deliberately not built here.
 *
 * Every figure is `costBasis: "list"` — what these calls would cost at
 * published rates, not money that changed hands. See lib/ai-pricing.ts.
 */
export async function GET(req: Request) {
  const limitParam = new URL(req.url).searchParams.get("limit");
  const parsed = limitParam === null ? NaN : Number(limitParam);
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;

  const records = limit === undefined ? getRecentUsage() : getRecentUsage(limit);
  return NextResponse.json(summarizeUsage(records));
}
