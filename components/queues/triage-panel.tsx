"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ListChecks, Loader2, Play } from "lucide-react";
import type { Decision, PlannedAction } from "@/lib/agent/types";
import type { TriageJob } from "@/lib/triage-jobs";
import type { DecisionAction } from "./triage-proposal-row";
import TriageProposalRow from "./triage-proposal-row";
import { Spinner } from "./ui";

/**
 * "Triage the backlog" — the LangGraph human-in-the-loop agent, in the product.
 *
 * ## What this panel is actually driving
 *
 * `lib/agent/graph.ts` is a four-node LangGraph:
 * `load_backlog -> assess -> propose -> apply_decisions`. The last node calls
 * `interrupt()` as its first statement, which throws a `GraphInterrupt` and
 * genuinely HALTS the graph — the checkpointer keeps the paused state and
 * nothing downstream runs. This panel is the human half of that interrupt.
 *
 * Which is why it looks like three screens rather than one form:
 *
 *   1. Start   — POST /api/triage kicks the graph off and returns a job id.
 *   2. Wait    — poll GET /api/triage/[id] until it says `awaiting-decisions`.
 *                Polling stops there: the graph is parked and will stay parked
 *                until a human moves, which is the point.
 *   3. Decide  — POST the decisions, which resumes the SAME paused graph via
 *                `Command({ resume })` on the SAME thread id.
 *
 * The paused graph lives in `lib/triage-jobs.ts` between steps 2 and 3, because
 * a stateless HTTP request cannot hold one. See that file's header.
 *
 * ## Honesty
 *
 * The verdicts here are not authoritative and the copy says so on screen rather
 * than only in a comment. `docs/evidence/langgraph-run-2026-09-02.md` records
 * the same eight issues coming back with different confidence numbers on
 * different runs of the same prompt against the same backlog. The interrupt is
 * exactly what makes that acceptable: the model proposes, the owner decides, and
 * nothing at all is written unless the owner ticks the write box.
 */

type Draft = { action: DecisionAction; note: string };

/** How long between polls while the graph is still working. */
const POLL_MS = 2000;

const STATUS_LINE: Record<TriageJob["status"], string> = {
  running: "load_backlog → assess → propose → [interrupt]",
  "awaiting-decisions": "HALTED at interrupt() — waiting on you",
  applying: "resuming the graph with your decisions…",
  done: "graph ran to END",
  error: "the run failed",
};

export default function TriagePanel({
  project,
  projectLabel,
  onChanged,
}: {
  project: string;
  projectLabel: string;
  /** Called after an APPLIED run, so the Ideas lists refetch their labels. */
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [job, setJob] = useState<TriageJob | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [apply, setApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same ticket pattern as ideas-view.tsx: a project switch must never let the
  // previous project's job land on the new project's panel, where its Apply
  // button would be pointed at the wrong repo.
  const reqIdRef = useRef(0);
  const jobIdRef = useRef<string | null>(null);

  const isWorking = job?.status === "running" || job?.status === "applying";

  /* ---------------- re-attach + polling ---------------- */

  const fetchJob = useCallback(
    async (id: string, ticket: number) => {
      try {
        const res = await fetch(`/api/triage/${encodeURIComponent(id)}`);
        const payload = await res.json().catch(() => ({}));
        if (reqIdRef.current !== ticket) return;
        if (!res.ok) throw new Error(payload.error ?? "Couldn't read the triage run.");
        setJob(payload.job as TriageJob);
      } catch (err) {
        if (reqIdRef.current !== ticket) return;
        setError(err instanceof Error ? err.message : "Couldn't read the triage run.");
      }
    },
    [],
  );

  // Project switch: drop everything and look for a run belonging to the new one.
  useEffect(() => {
    const ticket = ++reqIdRef.current;
    jobIdRef.current = null;
    setJob(null);
    setDrafts({});
    setApply(false);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/triage?project=${encodeURIComponent(project)}`);
        const payload = await res.json().catch(() => ({}));
        if (reqIdRef.current !== ticket || !res.ok) return;
        const found = (payload.job ?? null) as TriageJob | null;
        if (!found) return;
        jobIdRef.current = found.id;
        setJob(found);
        // A run the owner walked away from is worth surfacing without a click.
        if (found.status !== "done") setExpanded(true);
      } catch {
        /* no run to re-attach to — the panel just starts empty */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [project]);

  // Poll only while the AGENT is doing something. At `awaiting-decisions` the
  // graph is parked in the checkpointer and nothing changes until the owner
  // acts, so polling there would be a request every two seconds forever.
  useEffect(() => {
    if (!isWorking || !job) return;
    const ticket = reqIdRef.current;
    const id = job.id;
    const timer = setInterval(() => void fetchJob(id, ticket), POLL_MS);
    return () => clearInterval(timer);
  }, [isWorking, job, fetchJob]);

  /* ---------------- actions ---------------- */

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setDrafts({});
    setApply(false);
    const ticket = reqIdRef.current;
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, limit: 10 }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Couldn't start the triage run.");
      if (reqIdRef.current !== ticket) return;
      jobIdRef.current = payload.jobId as string;
      await fetchJob(payload.jobId as string, ticket);
    } catch (err) {
      if (reqIdRef.current !== ticket) return;
      setError(err instanceof Error ? err.message : "Couldn't start the triage run.");
    } finally {
      setBusy(false);
    }
  }, [project, fetchJob]);

  const submit = useCallback(async () => {
    if (!job) return;
    const decisions: Decision[] = Object.entries(drafts).map(([number, draft]) => ({
      number: Number(number),
      action: draft.action,
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    }));
    if (decisions.length === 0) {
      setError("Decide on at least one issue first.");
      return;
    }
    setBusy(true);
    setError(null);
    const ticket = reqIdRef.current;
    try {
      const res = await fetch(`/api/triage/${encodeURIComponent(job.id)}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions, apply }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Couldn't apply your decisions.");
      if (reqIdRef.current !== ticket) return;
      const finished = payload.job as TriageJob;
      setJob(finished);
      // Labels and comments only moved if this was a real apply.
      if (finished.applied) onChanged();
    } catch (err) {
      if (reqIdRef.current !== ticket) return;
      setError(err instanceof Error ? err.message : "Couldn't apply your decisions.");
    } finally {
      setBusy(false);
    }
  }, [job, drafts, apply, onChanged]);

  /* ---------------- render ---------------- */

  const decidedCount = Object.keys(drafts).length;

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span className="text-zinc-500">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <ListChecks className="h-4 w-4 shrink-0 text-violet-300" />
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Backlog triage agent
          </span>
          {job && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {job.status === "awaiting-decisions"
                ? `${job.proposals.length} waiting on you`
                : job.status}
            </span>
          )}
        </button>

        <button
          onClick={() => {
            setExpanded(true);
            void start();
          }}
          disabled={busy || isWorking || job?.status === "awaiting-decisions"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {busy || isWorking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run triage
        </button>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800 p-4">
          <p className="text-xs leading-relaxed text-zinc-500">
            A four-node LangGraph agent (
            <span className="text-zinc-400">load_backlog → assess → propose → apply_decisions</span>
            ) reads {projectLabel}&apos;s open issues and drafts a verdict on each. It then
            genuinely <span className="text-zinc-300">halts</span> — <code className="text-zinc-400">interrupt()</code>{" "}
            parks the graph in its checkpointer — and stays halted until you decide below.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
            Treat the verdicts as a first pass, not an answer. The same issue has come back with a
            different confidence number on different runs of the same prompt against the same
            backlog (docs/evidence/langgraph-run-2026-09-02.md). That is exactly why the graph stops
            here instead of acting: the model proposes, you decide.
          </p>

          {error && (
            <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {job && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
              <span className="font-mono text-zinc-500" title="LangGraph thread_id — the resume has to present this exact value">
                thread {job.id}
              </span>
              <span>{STATUS_LINE[job.status]}</span>
              <span>
                {job.backend} backend · {job.model}
              </span>
            </div>
          )}

          {job?.status === "running" && (
            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <Spinner /> Reading the backlog and assessing it — this takes about half a minute.
            </div>
          )}

          {job?.status === "awaiting-decisions" && (
            <div className="mt-4">
              {job.proposals.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No open issues came back, so there is nothing to decide.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-zinc-500">
                      {decidedCount} of {job.proposals.length} decided. Anything you leave undecided
                      is skipped — never auto-applied.
                    </p>
                    <button
                      onClick={() =>
                        setDrafts(
                          Object.fromEntries(
                            job.proposals.map((p) => [
                              p.number,
                              { action: p.recommendation as DecisionAction, note: "" },
                            ]),
                          ),
                        )
                      }
                      disabled={busy}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                      title="Fills every row with what the model said, so you can review and change rather than start blank. Still nothing is written until you apply."
                    >
                      Take the model&apos;s word on all
                    </button>
                  </div>

                  <div className="space-y-2">
                    {job.proposals.map((proposal) => (
                      <TriageProposalRow
                        key={proposal.number}
                        proposal={proposal}
                        decision={drafts[proposal.number]?.action ?? null}
                        note={drafts[proposal.number]?.note ?? ""}
                        disabled={busy}
                        onDecide={(action) =>
                          setDrafts((d) => ({
                            ...d,
                            [proposal.number]: { action, note: d[proposal.number]?.note ?? "" },
                          }))
                        }
                        onNote={(note) =>
                          setDrafts((d) => ({
                            ...d,
                            [proposal.number]: {
                              action: d[proposal.number]?.action ?? "needs-info",
                              note,
                            },
                          }))
                        }
                      />
                    ))}
                  </div>

                  <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <label className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={apply}
                        onChange={(e) => setApply(e.target.checked)}
                        disabled={busy}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-700 bg-zinc-950 accent-red-500"
                      />
                      <span className="min-w-0">
                        <span className="text-sm text-zinc-300">
                          Actually write these to GitHub
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500">
                          {apply
                            ? "ON — approve/decline add a label to the issue, needs-info posts a comment. Real writes to " +
                              `${job.repo.owner}/${job.repo.repo}.`
                            : "OFF — dry run. The graph still resumes and produces the exact actions it would take, but nothing reaches GitHub."}
                        </span>
                      </span>
                    </label>

                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => void submit()}
                        disabled={busy || decidedCount === 0}
                        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 ${
                          apply ? "bg-red-600 hover:bg-red-500" : "bg-emerald-600 hover:bg-emerald-500"
                        }`}
                      >
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {apply
                          ? `Apply ${decidedCount} decision${decidedCount === 1 ? "" : "s"} to GitHub`
                          : `Resume the graph (dry run)`}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {job?.status === "done" && <TriageResult job={job} />}

          {job?.status === "error" && (
            <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {job.error ?? "The run failed."}
            </div>
          )}

          {!job && !busy && (
            <p className="mt-3 text-xs text-zinc-600">
              Nothing running. Hit <span className="text-zinc-400">Run triage</span> to pull the
              10 oldest open issues and get a first pass on them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** What the resumed graph produced — the actions, and whether they landed. */
function TriageResult({ job }: { job: TriageJob }) {
  const wrote = job.actions.filter((a) => a.applied).length;
  const failed = job.actions.filter((a) => a.error).length;

  return (
    <div className="mt-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {job.applied ? "Applied" : "Would apply (dry run)"} — {job.actions.length} action
        {job.actions.length === 1 ? "" : "s"}
      </h4>

      <div className="space-y-1.5">
        {job.actions.map((action) => (
          <ActionRow key={action.number} action={action} />
        ))}
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        {job.applied
          ? `${wrote} write${wrote === 1 ? "" : "s"} reached GitHub${failed ? `, ${failed} failed` : ""}.`
          : "Nothing was written to GitHub. Run it again and tick the write box to actually do it."}
      </p>
    </div>
  );
}

function ActionRow({ action }: { action: PlannedAction }) {
  const status = action.error
    ? { text: `failed: ${action.error}`, cls: "bg-red-500/15 text-red-300" }
    : action.applied
      ? { text: "written", cls: "bg-emerald-500/15 text-emerald-300" }
      : action.kind === "none"
        ? { text: "no action", cls: "bg-zinc-800 text-zinc-500" }
        : { text: "dry run", cls: "bg-zinc-800 text-zinc-400" };

  return (
    <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <span className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-300">
        {action.summary}
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
        {status.text}
      </span>
    </div>
  );
}
