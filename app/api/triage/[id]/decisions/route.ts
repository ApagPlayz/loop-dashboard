import { NextResponse } from "next/server";

import {
  TriageJobError,
  getTriageJob,
  normalizeDecisions,
  resumeTriageJob,
} from "@/lib/triage-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A dry run resumes in milliseconds; an apply makes one GitHub write per action.
export const maxDuration = 60;

/**
 * POST /api/triage/[id]/decisions
 * Body: { decisions: [{ number, action, note? }], apply?: boolean }
 *
 * Hands the owner's decisions to the paused graph — `Command({ resume })` on the
 * same `thread_id`, against the same compiled graph and checkpointer still held
 * in lib/triage-jobs.ts. `apply_decisions` re-enters from its first line and
 * `interrupt()` returns these decisions instead of throwing.
 *
 * ## apply
 *
 * DRY RUN unless the body says `apply: true`, exactly as the CLI needs
 * `--apply`. Nothing weaker counts: the flag has to be the literal boolean
 * `true`, so a truthy string or a stray `1` does not become a write. This is the
 * only route in the app that can label or comment on the backlog in bulk.
 *
 * OWNER ONLY — no demo fixture, so anonymous callers get a 403 from the proxy.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: { decisions?: unknown; apply?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const job = getTriageJob(id);
  if (!job) {
    return NextResponse.json(
      {
        error:
          "That triage run is gone (runs are kept for an hour, and don't survive a dashboard restart). Start a new one.",
      },
      { status: 404 },
    );
  }

  // Validated against THIS run's proposals: a decision for an issue the owner
  // was never shown is dropped rather than acted on.
  const decisions = normalizeDecisions(job.proposals, body.decisions);
  if (decisions.length === 0) {
    return NextResponse.json(
      { error: "No usable decisions in that request." },
      { status: 400 },
    );
  }

  const apply = body.apply === true;

  try {
    const finished = await resumeTriageJob(id, decisions, apply);
    return NextResponse.json({ job: finished });
  } catch (err) {
    if (err instanceof TriageJobError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("triage/decisions: resume failed", err);
    return NextResponse.json({ error: "Couldn't resume the triage run." }, { status: 502 });
  }
}
