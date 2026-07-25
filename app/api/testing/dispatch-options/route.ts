import { NextResponse } from "next/server";
import { redraftIssueOptions, claudePrOptions } from "@/lib/testing";
import { listWorkflowFiles } from "@/lib/github";
import { resolveProjectFromUrl } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * Live choices for the Redraft (issues) and Demo (PRs) run cards, plus the list
 * of workflow files actually installed on the target repo — the cards use that
 * to show a "not installed yet" note only for capabilities the project is
 * genuinely missing, rather than assuming.
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const [redraftIssues, claudePrs, installed] = await Promise.all([
      redraftIssueOptions(repo),
      claudePrOptions(repo),
      listWorkflowFiles({ repo }),
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
