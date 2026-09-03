/**
 * Background jobs for the LangGraph backlog-triage agent.
 *
 * ## The problem this file exists to solve
 *
 * `lib/agent/graph.ts` halts inside `apply_decisions` by calling `interrupt()`.
 * That throws a `GraphInterrupt`; the checkpointer persists the paused state and
 * `invoke()` returns with a `__interrupt__` key. Resuming means invoking the
 * SAME compiled graph again, with the SAME `thread_id`, wrapped in
 * `new Command({ resume })`.
 *
 * A single HTTP request cannot do both halves. The owner has to look at the
 * proposals — that takes minutes — so the halt and the resume are necessarily
 * two different requests, and in between the paused graph has to survive
 * somewhere. It cannot be reconstructed on the second request: the graph is
 * compiled with a `MemorySaver`, and a fresh `MemorySaver` in a new request
 * scope has no checkpoint for that thread, so `Command({ resume })` would have
 * nothing to resume and the graph would simply start from `START` again — a
 * second full backlog fetch and a second paid model call, with the human's
 * decisions silently dropped.
 *
 * So the live session is held here, in a module-scoped `Map`, for the life of
 * the process. `startTriage()` returns a closure over the compiled graph and its
 * checkpointer; keeping that object alive keeps the paused graph alive with it.
 * `resumeTriageJob` reaches back into exactly that closure. Nothing about the
 * interrupt is reimplemented — this module is a shelf, not a state machine.
 *
 * ## Why there is no disk safety net (unlike lib/map-ai-jobs.ts)
 *
 * The sibling job stores mirror each job to a JSON file so a result survives a
 * dev-server reload. That would be actively misleading here. A halted triage job
 * IS the in-heap `TriageSession`; write its metadata to disk and a restarted
 * process would happily show the proposals and then fail on resume, because the
 * checkpointer they belong to is gone. Better to lose the job with the process
 * and say so than to offer a Resume button that cannot work. `status` therefore
 * only ever reflects what this process can still act on.
 *
 * Making a triage survive a restart is a one-line change in `graph.ts` —
 * `buildTriageGraph(deps, { checkpointer })` takes any `BaseCheckpointSaver`, so
 * a SqliteSaver or a DynamoDB saver would do it. That is deliberately not done
 * yet: see docs/ARCHITECTURE.md §3 on there being no database.
 *
 * ## One process only
 *
 * Like the six stores listed in infra/deploy.sh, this assumes a single Node
 * process. The ECS service is pinned to `desiredCount: 1` for exactly this
 * reason; with two tasks the poll for a job could land on the task that does not
 * hold it. Never raise that count without moving this state out of process
 * memory first.
 */

import { randomUUID } from "node:crypto";

import { startTriage, type TriageSession } from "./agent";
import type { Decision, PlannedAction, Proposal, RepoConfig } from "./agent/types";
import { AiError, aiBackend, aiModel } from "./map-ai";

/**
 * - `running`            — the graph is between START and the interrupt (this is
 *                          the slow part: one GitHub fetch, then the LLM calls).
 * - `awaiting-decisions` — HALTED at `interrupt()`. Proposals are ready and the
 *                          graph is parked in the checkpointer.
 * - `applying`           — resumed; running out the tail of `apply_decisions`.
 * - `done`               — `interrupt()` returned, actions produced.
 * - `error`              — nothing is parked; start a new run.
 */
export type TriageJobStatus =
  | "running"
  | "awaiting-decisions"
  | "applying"
  | "done"
  | "error";

/** The wire/UI view of a job. Never contains the live session object. */
export type TriageJob = {
  /** Job id. Also the LangGraph `thread_id` — one thread per run, by design. */
  id: string;
  projectKey: string;
  repo: RepoConfig;
  limit: number;
  status: TriageJobStatus;
  /** Which model actually produced the verdicts, so the UI can say so. */
  backend: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms the graph halted at the interrupt. */
  haltedAt?: number;
  proposals: Proposal[];
  decisions: Decision[];
  actions: PlannedAction[];
  /**
   * Whether the resume was allowed to write to GitHub. False on every dry run,
   * which is the default and what the UI shows unless the owner opts in.
   */
  applied: boolean;
  error?: string;
  errorStatus?: number;
};

const TTL_MS = 60 * 60 * 1000; // 1 hour, matching the sibling job stores.

const jobs = new Map<string, TriageJob>();

/**
 * The paused graphs themselves. Deliberately separate from `jobs` and never
 * exported: a `TriageSession` closes over a compiled graph and a MemorySaver, so
 * it is neither serializable nor safe to hand to a route.
 */
const sessions = new Map<string, TriageSession>();

/** Drop expired jobs, and the paused graphs they were holding open. */
function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt >= cutoff) continue;
    jobs.delete(id);
    sessions.delete(id);
  }
}

function touch(job: TriageJob): void {
  job.updatedAt = Date.now();
}

/* ------------------------------------------------------------------ */
/* Starting a run                                                      */
/* ------------------------------------------------------------------ */

export type StartTriageJobInput = {
  projectKey: string;
  repo: RepoConfig;
  /** How many open issues to pull. Clamped by the caller. */
  limit: number;
};

/**
 * Create a job and run the graph up to the interrupt WITHOUT awaiting it.
 *
 * Returns immediately with a `running` job; the client polls
 * `GET /api/triage/[id]` until it reports `awaiting-decisions`. The run itself
 * is a real backlog fetch plus real model calls and takes ~30 s on eight issues,
 * which is far too long to hold an HTTP request open.
 */
export function startTriageJob(input: StartTriageJobInput): TriageJob {
  sweep();

  // The job id IS the thread id. One run, one thread — the resume has to present
  // the same one, and deriving it from anything else invites them drifting.
  const id = `triage-${randomUUID()}`;
  const job: TriageJob = {
    id,
    projectKey: input.projectKey,
    repo: input.repo,
    limit: input.limit,
    status: "running",
    backend: aiBackend(),
    model: aiModel(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    proposals: [],
    decisions: [],
    actions: [],
    applied: false,
  };
  jobs.set(id, job);

  startTriage({
    repo: input.repo,
    limit: input.limit,
    // Dry run. Always. The owner opts into writes at the resume step, never here
    // — at this point nobody has seen a proposal yet.
    apply: false,
    threadId: id,
  })
    .then((session) => {
      // The job may have been swept while the model was thinking.
      if (!jobs.has(id)) return;
      sessions.set(id, session);
      job.proposals = session.proposals;
      job.status = "awaiting-decisions";
      job.haltedAt = Date.now();
      touch(job);
    })
    .catch((err: unknown) => {
      if (!jobs.has(id)) return;
      job.status = "error";
      touch(job);
      if (err instanceof AiError) {
        job.error = err.message;
        job.errorStatus = err.httpStatus;
      } else {
        console.error("triage-jobs: run failed", err);
        job.error =
          err instanceof Error && err.message
            ? err.message
            : "The triage agent failed before it could halt for you. Try again.";
        job.errorStatus = 502;
      }
    });

  return job;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export function getTriageJob(id: string): TriageJob | null {
  sweep();
  return jobs.get(id) ?? null;
}

/** Newest job for a project, so a returning panel can re-attach to it. */
export function latestTriageJobForProject(projectKey: string): TriageJob | null {
  sweep();
  let best: TriageJob | null = null;
  for (const job of jobs.values()) {
    if (job.projectKey !== projectKey) continue;
    if (!best || job.createdAt > best.createdAt) best = job;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Resuming                                                            */
/* ------------------------------------------------------------------ */

export class TriageJobError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "TriageJobError";
  }
}

/**
 * Hand the human's decisions back to the paused graph.
 *
 * This awaits, unlike `startTriageJob`: the resume re-enters `apply_decisions`
 * from its first line, `interrupt()` returns the decisions instead of throwing,
 * and no model call happens on the second pass — it is milliseconds in dry run,
 * and a handful of GitHub writes when applying.
 *
 * `apply` defaults to FALSE. A caller that wants writes has to say so.
 */
export async function resumeTriageJob(
  id: string,
  decisions: Decision[],
  apply = false,
): Promise<TriageJob> {
  sweep();
  const job = jobs.get(id);
  if (!job) {
    throw new TriageJobError(
      "That triage run is gone (runs are kept for an hour, and don't survive a dashboard restart). Start a new one.",
      404,
    );
  }
  if (job.status === "done") {
    throw new TriageJobError("You already decided on this run. Start a new one.", 409);
  }
  if (job.status === "running") {
    throw new TriageJobError("The agent hasn't finished assessing yet.", 409);
  }
  if (job.status === "applying") {
    throw new TriageJobError("Those decisions are already being applied.", 409);
  }
  if (job.status === "error") {
    throw new TriageJobError(job.error ?? "That triage run failed.", 409);
  }

  const session = sessions.get(id);
  if (!session) {
    // Belt and braces: `awaiting-decisions` without a session should be
    // impossible, since they are set together. If it ever happens, refuse
    // rather than starting the graph over behind the owner's back.
    job.status = "error";
    job.error = "The paused graph for this run is no longer in memory. Start a new one.";
    job.errorStatus = 410;
    touch(job);
    throw new TriageJobError(job.error, 410);
  }

  job.status = "applying";
  job.applied = apply;
  touch(job);

  try {
    const result = await session.resume(decisions, { apply });
    job.decisions = result.decisions;
    job.actions = result.actions;
    job.status = "done";
    touch(job);
    // The graph has run to END; its checkpoint is spent. Drop the session so a
    // finished run stops pinning a compiled graph in memory.
    sessions.delete(id);
    return job;
  } catch (err) {
    job.status = "error";
    job.applied = false;
    job.error =
      err instanceof Error && err.message
        ? err.message
        : "Resuming the triage graph failed.";
    job.errorStatus = 502;
    touch(job);
    console.error("triage-jobs: resume failed", err);
    throw new TriageJobError(job.error, 502);
  }
}

/* ------------------------------------------------------------------ */
/* Input validation                                                    */
/* ------------------------------------------------------------------ */

const DECISION_ACTIONS = new Set(["approve", "decline", "needs-info", "skip"]);

/** Longest override note we will turn into a GitHub comment body. */
const MAX_NOTE = 2000;

/**
 * Turn an untrusted request body into decisions the graph can be resumed with.
 *
 * Three rules, all of them about the graph never acting on something the owner
 * did not actually see:
 *
 *  - a decision for an issue that is not in THIS run's proposals is dropped
 *    (otherwise a crafted body could label an arbitrary issue number);
 *  - an unrecognised action is dropped rather than coerced, because the safe
 *    coercion is "skip" and silently downgrading a decision is worse than
 *    refusing it;
 *  - anything the caller left out stays out. `apply_decisions` already treats a
 *    proposal with no decision as `skip`, so an omission can only ever mean
 *    "do nothing", never "do the model's thing".
 */
export function normalizeDecisions(proposals: Proposal[], raw: unknown): Decision[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(proposals.map((p) => p.number));
  const out = new Map<number, Decision>();
  for (const entry of raw) {
    const e = entry as Partial<Decision>;
    const number = Number(e?.number);
    if (!Number.isInteger(number) || !known.has(number)) continue;
    const action = String(e?.action ?? "");
    if (!DECISION_ACTIONS.has(action)) continue;
    const note = typeof e?.note === "string" ? e.note.trim().slice(0, MAX_NOTE) : "";
    out.set(number, {
      number,
      action: action as Decision["action"],
      ...(note ? { note } : {}),
    });
  }
  return [...out.values()];
}

/* ------------------------------------------------------------------ */
/* Test seam                                                           */
/* ------------------------------------------------------------------ */

/**
 * Drop every job and every paused graph. Exported for tests only — nothing in
 * the app calls this, because losing a halted run loses the owner's place.
 */
export function resetTriageJobs(): void {
  jobs.clear();
  sessions.clear();
}

/**
 * Park an already-halted session under a job. Test seam: it lets a test drive
 * the store with injected fake deps (no GitHub, no LLM) instead of going through
 * `startTriageJob`, which always reaches for the real ones.
 */
export function adoptTriageSession(job: TriageJob, session: TriageSession): void {
  jobs.set(job.id, job);
  sessions.set(job.id, session);
}
