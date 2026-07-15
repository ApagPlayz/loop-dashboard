import { NextResponse } from "next/server";
import { getFileContent } from "@/lib/github";
import { parseMetrics, splitMetrics } from "@/lib/testing";

export const dynamic = "force-dynamic";

/**
 * Before/after metrics comparison around a change. Query: ?date=<ISO commit date>
 * Splits metrics/loop-metrics.json snapshots into before (dated before the
 * commit) and after (commit date onward), and returns averaged windows.
 */
export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }
  try {
    const raw = await getFileContent("metrics/loop-metrics.json");
    const snapshots = parseMetrics(raw);
    if (snapshots.length === 0) {
      return NextResponse.json({ noMetrics: true });
    }
    return NextResponse.json(splitMetrics(snapshots, date));
  } catch {
    return NextResponse.json(
      { error: "Could not load metrics." },
      { status: 500 },
    );
  }
}
