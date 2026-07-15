import { NextResponse } from "next/server";
import { getCommitWorkflowPatch } from "@/lib/testing";

export const dynamic = "force-dynamic";

/** The workflow-file patch(es) for one commit. Query: ?sha=<sha> */
export async function GET(req: Request) {
  const sha = new URL(req.url).searchParams.get("sha");
  if (!sha) {
    return NextResponse.json({ error: "Missing sha" }, { status: 400 });
  }
  try {
    const data = await getCommitWorkflowPatch(sha);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Could not load the change." },
      { status: 500 },
    );
  }
}
