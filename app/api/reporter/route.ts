import { NextResponse } from "next/server";
import { getDigest } from "@/lib/reporter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/reporter — the cached digest (builds once if empty). */
export async function GET() {
  try {
    const digest = await getDigest();
    return NextResponse.json({ digest });
  } catch (e) {
    console.error("reporter: GET failed", e);
    return NextResponse.json(
      { error: "Couldn't load the news digest. Try refreshing." },
      { status: 502 },
    );
  }
}
