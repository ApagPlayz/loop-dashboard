import { NextResponse } from "next/server";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import {
  listLoopWorkflows,
  setWorkflowEnabled,
  pauseLoop,
  resumeLoop,
  readPauseState,
} from "@/lib/map-power";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/power?project=<key>
 * Current on/off state of every loop workflow.
 * Returns: { workflows: [{file, name, state, enabled, isMention}], loopPaused,
 *            pauseRecord: {disabled, pausedAt} | null }
 * `pauseRecord` is only read (and non-null) while the loop is paused — it's
 * what the UI shows to be honest about what Resume will do before the owner
 * clicks it. `null` means "no usable record" (missing, unreadable, or the
 * loop was paused before this existed) — Resume will need explicit
 * confirmation before it can blanket-enable.
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const workflows = await listLoopWorkflows(repo);
    const pausable = workflows.filter((w) => !w.isMention);
    const loopPaused = pausable.length > 0 && pausable.every((w) => !w.enabled);
    const pauseRecord = loopPaused ? await readPauseState(repo) : null;
    return NextResponse.json({ workflows, loopPaused, pauseRecord });
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
 *       { action: "resume" }              — restore exactly what pause turned off, if known
 *       { action: "resume", confirmBlanket: true }
 *                                         — no record exists; explicitly enable everything
 *                                           currently off anyway (the pre-this-feature behaviour)
 *       { file: "claude-scout.yml", enable: boolean } — one workflow
 *
 * Returns: { ok: true, changed: string[], mode? } for a completed action, or
 *          { ok: false, needsConfirmation: true, wouldEnable: string[] } when
 *          "resume" has no usable pre-pause record and hasn't been confirmed
 *          yet — nothing is changed in that case.
 */
export async function POST(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    let body: { action?: string; file?: string; enable?: boolean; confirmBlanket?: boolean };
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
      const result = await resumeLoop(repo, { confirmBlanket: body.confirmBlanket === true });
      if (result.mode === "needs-confirmation") {
        return NextResponse.json({ ok: false, needsConfirmation: true, wouldEnable: result.wouldEnable });
      }
      return NextResponse.json({ ok: true, changed: result.changed, mode: result.mode });
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
