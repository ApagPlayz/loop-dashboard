import { NextResponse } from "next/server";
import { createIssue } from "@/lib/github";
import { resolveProject, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  project?: string;
  title?: string;
  body?: string;
  viaClarify?: boolean;
};

/** Turn free text into a short title: first sentence, trimmed to 80 chars. */
function deriveTitle(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const source = firstLine || text.trim();
  // Cut at the first sentence end if there is one early enough.
  const sentenceMatch = source.match(/^(.+?[.!?])(\s|$)/);
  let title = sentenceMatch ? sentenceMatch[1] : source;
  title = title.replace(/\s+/g, " ").trim();
  if (title.length > 80) title = title.slice(0, 79).trimEnd() + "…";
  return title || "Custom idea";
}

/**
 * POST /api/ideas/custom
 *
 * File the owner's custom idea as a `proposal` issue on the chosen project so
 * it enters the normal triage queue. Body: { project, title?, body, viaClarify }.
 * Returns { number, htmlUrl }.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const ideaBody = (body.body ?? "").trim();
  if (!ideaBody) {
    return NextResponse.json(
      { error: "Write your idea before submitting." },
      { status: 400 },
    );
  }

  let resolved;
  try {
    resolved = await resolveProject(body.project);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
  const { repo } = resolved;

  const title = (body.title ?? "").trim() || deriveTitle(ideaBody);

  const provenance = body.viaClarify
    ? "> Custom idea filed by the owner from the dashboard (refined with clarifying questions)."
    : "> Custom idea filed by the owner from the dashboard.";
  const issueBody = `${provenance}\n\n${ideaBody}`;

  try {
    const issue = await createIssue(title, issueBody, ["proposal"], repo);
    return NextResponse.json({ number: issue.number, htmlUrl: issue.html_url });
  } catch (err) {
    console.error("ideas/custom: create failed", err);
    return NextResponse.json(
      { error: "Couldn't file the idea on GitHub. Try again." },
      { status: 502 },
    );
  }
}
