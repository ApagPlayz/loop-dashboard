import { NextResponse } from "next/server";
import { redraftIssueOptions, claudePrOptions } from "@/lib/testing";

export const dynamic = "force-dynamic";

/** Live choices for the Redraft (issues) and Demo (PRs) run cards. */
export async function GET() {
  try {
    const [redraftIssues, claudePrs] = await Promise.all([
      redraftIssueOptions(),
      claudePrOptions(),
    ]);
    return NextResponse.json({ redraftIssues, claudePrs });
  } catch {
    return NextResponse.json(
      { redraftIssues: [], claudePrs: [], error: "Could not load choices." },
      { status: 500 },
    );
  }
}
