/**
 * Backlog-triage agent — a four-node LangGraph.js graph with a real
 * human-in-the-loop interrupt.
 *
 *   load_backlog -> assess -> propose -> apply_decisions
 *                                        ^-- interrupt() at the top
 *
 * The graph genuinely halts inside `apply_decisions`: `interrupt()` throws a
 * `GraphInterrupt`, the checkpointer persists the state, and `invoke()` returns
 * with a `__interrupt__` key. Resuming with `new Command({ resume })` re-enters
 * the SAME node from the top, and `interrupt()` returns the resume value
 * instead of throwing.
 *
 * GOTCHA that shapes this file: because resume re-runs `apply_decisions` from
 * its first line, there must be NO side effects before the `interrupt()` call.
 * Everything above it is pure state reads.
 *
 * No Next.js imports here (or in ./types.ts) so this directory can be deployed
 * to AWS Bedrock AgentCore Runtime as-is.
 */

import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import type {
  Assessment,
  BacklogItem,
  Decision,
  PlannedAction,
  Proposal,
  RepoConfig,
  ResumeValue,
  ReviewRequest,
  TriageDeps,
} from "./types";

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

/** Last-write-wins channel. Every field here is replaced, never merged. */
function replace<T>(initial: () => T) {
  return Annotation<T>({ reducer: (_prev: T, next: T) => next, default: initial });
}

export const TriageState = Annotation.Root({
  /** Which repo to triage. */
  repo: replace<RepoConfig>(() => ({ owner: "", repo: "" })),
  /** Max issues to pull. */
  limit: replace<number>(() => 20),
  /**
   * DRY-RUN BY DEFAULT. Nothing is written to GitHub unless this is explicitly
   * set to true by the caller.
   */
  apply: replace<boolean>(() => false),

  items: replace<BacklogItem[]>(() => []),
  assessments: replace<Assessment[]>(() => []),
  proposals: replace<Proposal[]>(() => []),
  decisions: replace<Decision[]>(() => []),
  actions: replace<PlannedAction[]>(() => []),
});

export type TriageStateType = typeof TriageState.State;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Split into batches so `assess` makes a few LLM calls, not one per issue. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Normalize whatever the human handed back into a plain Decision[]. */
export function normalizeResume(value: ResumeValue | null | undefined): Decision[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.decisions;
  return Array.isArray(list) ? list : [];
}

/**
 * Turn one (proposal, decision) pair into the GitHub write we would make.
 * Pure — safe to run in dry-run and in apply mode alike.
 */
export function planAction(proposal: Proposal, decision: Decision): PlannedAction {
  const base = { number: proposal.number, applied: false };
  switch (decision.action) {
    case "approve":
      return {
        ...base,
        kind: "add-label",
        detail: "approved",
        summary: `#${proposal.number} → add label "approved"`,
      };
    case "decline":
      return {
        ...base,
        kind: "add-label",
        detail: "declined",
        summary: `#${proposal.number} → add label "declined"`,
      };
    case "needs-info": {
      const body =
        decision.note?.trim() ||
        `Triage agent needs more detail before this can be actioned: ${proposal.reason}`;
      return {
        ...base,
        kind: "comment",
        detail: body,
        summary: `#${proposal.number} → comment: ${body.slice(0, 80)}`,
      };
    }
    default:
      return {
        ...base,
        kind: "none",
        detail: "",
        summary: `#${proposal.number} → skipped (no action)`,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */

const ASSESS_BATCH_SIZE = 10;

/** 1. Fetch open issues from the target repo. */
function makeLoadBacklog(deps: TriageDeps) {
  return async (state: TriageStateType) => {
    const items = await deps.listBacklog(state.repo, state.limit);
    return { items };
  };
}

/** 2. Group the items into a few batched LLM calls, one verdict per issue. */
function makeAssess(deps: TriageDeps) {
  return async (state: TriageStateType) => {
    if (state.items.length === 0) return { assessments: [] };
    const assessments: Assessment[] = [];
    // Sequential on purpose: the local CLI backend spawns a process per call.
    for (const batch of chunk(state.items, ASSESS_BATCH_SIZE)) {
      assessments.push(...(await deps.assessBatch(batch)));
    }
    return { assessments };
  };
}

/** 3. Join verdicts back onto items and park the list in state. */
function proposeNode(state: TriageStateType) {
  const byNumber = new Map(state.assessments.map((a) => [a.number, a]));
  const proposals: Proposal[] = state.items.map((item) => {
    const a = byNumber.get(item.number);
    return {
      ...item,
      recommendation: a?.recommendation ?? "needs-info",
      reason: a?.reason ?? "No assessment returned for this issue.",
      confidence: typeof a?.confidence === "number" ? a.confidence : 0,
    };
  });
  return { proposals };
}

/**
 * 4. HALT for the human, then apply.
 *
 * `interrupt()` is the FIRST statement that does anything. On resume this whole
 * function re-runs from line one, so anything above the interrupt would run
 * twice — hence nothing above it but pure reads.
 */
function makeApplyDecisions(deps: TriageDeps) {
  return async (state: TriageStateType) => {
    const request: ReviewRequest = {
      kind: "triage-review",
      repo: state.repo,
      proposals: state.proposals,
    };

    // === execution stops here until Command({ resume }) arrives ===
    const resume = interrupt<ReviewRequest, ResumeValue>(request);

    const supplied = normalizeResume(resume);
    const byNumber = new Map(supplied.map((d) => [d.number, d]));

    const actions: PlannedAction[] = [];
    for (const proposal of state.proposals) {
      // Anything the human didn't rule on is skipped, never auto-applied.
      const decision = byNumber.get(proposal.number) ?? {
        number: proposal.number,
        action: "skip" as const,
      };
      const action = planAction(proposal, decision);

      if (state.apply && action.kind !== "none") {
        try {
          await deps.applyAction(state.repo, action);
          action.applied = true;
        } catch (err) {
          action.error = err instanceof Error ? err.message : String(err);
        }
      }
      actions.push(action);
    }

    return { decisions: supplied, actions };
  };
}

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

export type BuildOptions = {
  /**
   * Swapping the in-memory saver for a persistent one (SqliteSaver,
   * PostgresSaver, DynamoDB) is a one-line change: pass it here.
   */
  checkpointer?: BaseCheckpointSaver;
};

/**
 * Build and compile the triage graph.
 *
 * A checkpointer is REQUIRED for the interrupt to work — without one there is
 * nowhere to persist the paused state, and `Command({ resume })` has nothing to
 * resume. In-memory is fine for the CLI and for tests; swapping to a persistent
 * saver is a one-line change (pass `checkpointer`).
 */
export function buildTriageGraph(deps: TriageDeps, opts: BuildOptions = {}) {
  const checkpointer = opts.checkpointer ?? new MemorySaver();

  return new StateGraph(TriageState)
    .addNode("load_backlog", makeLoadBacklog(deps))
    .addNode("assess", makeAssess(deps))
    .addNode("propose", proposeNode)
    .addNode("apply_decisions", makeApplyDecisions(deps))
    .addEdge(START, "load_backlog")
    .addEdge("load_backlog", "assess")
    .addEdge("assess", "propose")
    .addEdge("propose", "apply_decisions")
    .addEdge("apply_decisions", END)
    .compile({ checkpointer });
}

export type TriageGraph = ReturnType<typeof buildTriageGraph>;
