import { NextResponse } from "next/server";
import { listActionNeededIssues } from "@/lib/tools";

export const dynamic = "force-dynamic";

/** Open "🔑 Action needed" issues the owner has to act on. */
export async function GET() {
  try {
    const issues = await listActionNeededIssues();
    return NextResponse.json({ issues });
  } catch {
    return NextResponse.json(
      { issues: [], error: "Could not load tasks." },
      { status: 500 },
    );
  }
}
