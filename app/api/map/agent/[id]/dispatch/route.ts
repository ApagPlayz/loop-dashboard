import { NextResponse } from "next/server";
import { dispatchWorkflow } from "@/lib/github";
import { resolveProjectFromUrl, findProjectAgent, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/map/agent/[id]/dispatch?project=<key>
 * Manually trigger a workflow (workflow_dispatch on main).
 *
 * Body: { input?: string }  — the idea/PR number, when the workflow needs one.
 * Returns: { ok: true }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let project, repo;
  try {
    ({ project, repo } = await resolveProjectFromUrl(req.url));
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
  const meta = await findProjectAgent(project, id);
  if (!meta) return NextResponse.json({ error: "Unknown agent." }, { status: 404 });

  if (!meta.canDispatch) {
    return NextResponse.json(
      { error: "This workflow can't be started by hand." },
      { status: 400 },
    );
  }

  let body: { input?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine for inputless workflows.
  }

  // Build the workflow_dispatch inputs the specific workflow expects.
  const inputs: Record<string, string> = {};
  if (meta.dispatch === "issue") {
    const n = (body.input ?? "").trim();
    if (!/^\d+$/.test(n)) {
      return NextResponse.json({ error: "Enter a valid idea number." }, { status: 400 });
    }
    inputs.issue_number = n;
  } else if (meta.dispatch === "pr") {
    const n = (body.input ?? "").trim();
    if (!/^\d+$/.test(n)) {
      return NextResponse.json({ error: "Enter a valid pull request number." }, { status: 400 });
    }
    inputs.pr_number = n;
  }

  try {
    await dispatchWorkflow(meta.file, "main", inputs, repo);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      return NextResponse.json(
        { error: "GitHub couldn't find this workflow to run. It may not be on main yet." },
        { status: 404 },
      );
    }
    console.error(`dispatch[${id}]: failed`, err);
    return NextResponse.json(
      { error: "Couldn't start the run. Please try again." },
      { status: 502 },
    );
  }
}
