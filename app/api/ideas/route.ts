import { NextResponse } from "next/server";
import { loadIdeas } from "@/lib/queues";

export const dynamic = "force-dynamic";

/** GET /api/ideas — all four Ideas tabs with their issues. */
export async function GET() {
  try {
    const data = await loadIdeas();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: errorMessage(err) },
      { status: 502 },
    );
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not reach GitHub. Try again in a moment.";
}
