import { NextResponse } from "next/server";
import { getCommitWorkflowPatch } from "@/lib/testing";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** The workflow-file patch(es) for one commit. Query: ?sha=<sha> */
export async function GET(req: Request) {
  const sha = new URL(req.url).searchParams.get("sha");
  if (!sha) {
    return NextResponse.json({ error: "Missing sha" }, { status: 400 });
  }
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const data = await getCommitWorkflowPatch(sha, repo);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json(
      { error: "Could not load the change." },
      { status: 500 },
    );
  }
}
