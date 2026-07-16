import { NextResponse } from "next/server";
import { refreshDigest } from "@/lib/reporter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/reporter/refresh — re-pull every source and return the fresh digest. */
export async function POST() {
  try {
    const digest = await refreshDigest();
    return NextResponse.json({ digest });
  } catch (e) {
    console.error("reporter: refresh failed", e);
    return NextResponse.json(
      { error: "The refresh didn't complete. Try again in a moment." },
      { status: 502 },
    );
  }
}
