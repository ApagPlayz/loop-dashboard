import { NextResponse } from "next/server";
import { startJob } from "@/lib/map-ai-jobs";
import { AiError } from "@/lib/map-ai";
import { runSharedRefresh } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/reporter/refresh — re-pull every source in a background job.
 * Returns { jobId } immediately; the client polls GET /api/map/ai-job/[id]
 * (and can leave the page — /api/map/ai-job/latest restores it). The fresh
 * digest is persisted server-side by the refresh, so when the job is done the
 * client just re-fetches GET /api/reporter; the job result stays small.
 *
 * Goes through `runSharedRefresh` (the single-flight guard in ../route.ts),
 * not `refreshDigest` directly. Calling refreshDigest here bypassed the very
 * guard the comments claimed it used: two taps on "Refresh now", or a tap
 * landing on a cron tick, started two full pulls of every source at once, both
 * writing the same cache. They now join one run.
 */
export async function POST() {
  const job = startJob("reporter-refresh", {}, async () => {
    try {
      const digest = await runSharedRefresh();
      return { itemCount: digest.items.length, lastUpdated: digest.lastUpdated };
    } catch (e) {
      console.error("reporter: refresh failed", e);
      throw new AiError("The refresh didn't complete. Try again in a moment.", 502);
    }
  });
  return NextResponse.json({ jobId: job.id });
}
