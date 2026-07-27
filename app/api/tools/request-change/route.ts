import { NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import { resolveProject, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ask Claude to change or remove a shared tool. Opens a plain (unlabeled) issue
 * whose body starts with "@claude " so the mention agent picks it up.
 * Body: { project: string, request: string }.
 *
 * `project` is required — the issue is filed in that project's repo. It used
 * to always land on the pilot regardless of the switcher.
 */
export async function POST(req: Request) {
  let body: { project?: string; request?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const request = (body.request ?? "").trim();
  if (!request) {
    return NextResponse.json(
      { error: "Describe what you'd like changed." },
      { status: 400 },
    );
  }

  const title = `Tool change request: ${request.slice(0, 60)}${request.length > 60 ? "…" : ""}`;

  try {
    const { repo } = await resolveProject(body.project);
    const res = await getOctokit().rest.issues.create({
      owner: repo.owner,
      repo: repo.repo,
      title,
      body: `@claude ${request}\n\n_(Requested from the dashboard's Tools page — shared-tool change.)_`,
    });
    return NextResponse.json({ ok: true, url: res.data.html_url });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json(
      { error: "Could not send the request. Please try again." },
      { status: 500 },
    );
  }
}
