import { NextResponse } from "next/server";
import { dispatchWorkflow } from "@/lib/github";
import { findWorkflow } from "@/lib/testing";

/**
 * Trigger a workflow by hand. Body: { file: string, inputs?: Record<string,string> }.
 * A 404 from GitHub means the workflow file isn't on main yet (the PR #44
 * workflows) — we translate that into a friendly "not live yet" message.
 */
export async function POST(req: Request) {
  let body: { file?: string; inputs?: Record<string, string> } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const file = body.file;
  if (!file || !findWorkflow(file)) {
    return NextResponse.json({ error: "Unknown workflow" }, { status: 400 });
  }

  try {
    await dispatchWorkflow(file, "main", body.inputs ?? {});
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? (err as { status?: number }).status
        : undefined;
    if (status === 404) {
      return NextResponse.json(
        {
          error:
            "This agent isn't live yet — waiting for PR #44 to merge on the target repo.",
          notLive: true,
        },
        { status: 404 },
      );
    }
    if (status === 422) {
      return NextResponse.json(
        {
          error:
            "GitHub rejected the run — it may need an input, or the workflow can't be dispatched.",
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "Could not start the run. Please try again." },
      { status: 500 },
    );
  }
}
