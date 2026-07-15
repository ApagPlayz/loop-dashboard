import { NextResponse } from "next/server";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import {
  listLoopWorkflows,
  setWorkflowEnabled,
  pauseLoop,
  resumeLoop,
} from "@/lib/map-power";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/power?project=<key>
 * Current on/off state of every loop workflow.
 * Returns: { workflows: [{file, name, state, enabled, isMention}], loopPaused }
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const workflows = await listLoopWorkflows(repo);
    const pausable = workflows.filter((w) => !w.isMention);
    const loopPaused = pausable.length > 0 && pausable.every((w) => !w.enabled);
    return NextResponse.json({ workflows, loopPaused });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("power: list failed", err);
    return NextResponse.json(
      { error: "Couldn't read the workflow switches from GitHub. Try again." },
      { status: 502 },
    );
  }
}

/**
 * POST /api/map/power?project=<key>
 * Body: { action: "pause" }               — switch the loop off (@mention stays on)
 *       { action: "resume" }              — switch everything back on
 *       { file: "claude-scout.yml", enable: boolean } — one workflow
 * Returns: { ok: true, changed: string[] }
 */
export async function POST(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    let body: { action?: string; file?: string; enable?: boolean };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }

    if (body.action === "pause") {
      const changed = await pauseLoop(repo);
      return NextResponse.json({ ok: true, changed });
    }
    if (body.action === "resume") {
      const changed = await resumeLoop(repo);
      return NextResponse.json({ ok: true, changed });
    }
    if (typeof body.file === "string" && typeof body.enable === "boolean") {
      if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(body.file)) {
        return NextResponse.json({ error: "Invalid workflow name." }, { status: 400 });
      }
      await setWorkflowEnabled(repo, body.file, body.enable);
      return NextResponse.json({ ok: true, changed: [body.file] });
    }
    return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("power: toggle failed", err);
    return NextResponse.json(
      { error: "Couldn't flip the switch on GitHub. Try again." },
      { status: 502 },
    );
  }
}
