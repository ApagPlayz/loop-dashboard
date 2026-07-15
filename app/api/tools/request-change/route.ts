import { NextResponse } from "next/server";
import { getOctokit, REPOS } from "@/lib/github";

/**
 * Ask Claude to change or remove a shared tool. Opens a plain (unlabeled) issue
 * whose body starts with "@claude " so the mention agent picks it up. Body:
 * { request: string }.
 */
export async function POST(req: Request) {
  let body: { request?: string } = {};
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

  const { owner, repo } = REPOS.primary;
  const title = `Tool change request: ${request.slice(0, 60)}${request.length > 60 ? "…" : ""}`;

  try {
    const res = await getOctokit().rest.issues.create({
      owner,
      repo,
      title,
      body: `@claude ${request}\n\n_(Requested from the dashboard's Tools page — shared-tool change.)_`,
    });
    return NextResponse.json({ ok: true, url: res.data.html_url });
  } catch {
    return NextResponse.json(
      { error: "Could not send the request. Please try again." },
      { status: 500 },
    );
  }
}
