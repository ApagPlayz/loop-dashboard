import { NextResponse } from "next/server";
import { redraftIssueOptions, claudePrOptions } from "@/lib/testing";
import { listWorkflowFiles } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * Live choices for the Redraft (issues) and Demo (PRs) run cards, plus the list
 * of workflow files actually installed on the target repo — the cards use that
 * to show a "not installed yet" note only for capabilities the project is
 * genuinely missing, rather than assuming.
 */
export async function GET() {
  try {
    const [redraftIssues, claudePrs, installed] = await Promise.all([
      redraftIssueOptions(),
      claudePrOptions(),
      listWorkflowFiles(),
    ]);
    return NextResponse.json({ redraftIssues, claudePrs, installed });
  } catch {
    return NextResponse.json(
      {
        redraftIssues: [],
        claudePrs: [],
        installed: null,
        error: "Could not load choices.",
      },
      { status: 500 },
    );
  }
}
