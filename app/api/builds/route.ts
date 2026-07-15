import { NextResponse } from "next/server";
import { loadBuilds } from "@/lib/queues";

export const dynamic = "force-dynamic";

/** GET /api/builds — the three Builds tabs (needs review / merged / closed). */
export async function GET() {
  try {
    const data = await loadBuilds();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "GitHub request failed." },
      { status: 502 },
    );
  }
}
