/**
 * Public surface of the backlog-triage agent.
 *
 * Typical use:
 *   const session = await startTriage({ repo, limit: 10 });   // halts at interrupt
 *   ...show session.review.proposals to a human...
 *   const result = await session.resume(decisions);            // dry-run apply
 */

import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";

import { buildTriageGraph } from "./graph";
import { DEFAULT_REPO, realDeps } from "./deps";
import type {
  Decision,
  PlannedAction,
  Proposal,
  RepoConfig,
  ReviewRequest,
  TriageDeps,
} from "./types";

export * from "./types";
export { buildTriageGraph, chunk, normalizeResume, planAction, TriageState } from "./graph";
export { DEFAULT_REPO, realDeps, coerceAssessments } from "./deps";

export type TriageOptions = {
  repo?: RepoConfig;
  limit?: number;
  /** DRY-RUN unless this is explicitly true. */
  apply?: boolean;
  /** Inject fakes in tests; defaults to the real GitHub + LLM. */
  deps?: TriageDeps;
  /** Checkpoint thread. One per triage run. */
  threadId?: string;
};

export type TriageSession = {
  threadId: string;
  /** What the human is being asked to decide. */
  review: ReviewRequest;
  proposals: Proposal[];
  /** Resume the halted graph with the human's decisions. */
  resume(decisions: Decision[]): Promise<{ actions: PlannedAction[]; decisions: Decision[] }>;
};

/**
 * Run the graph up to the human-in-the-loop interrupt and return the paused
 * session. The graph is genuinely halted at this point — its state lives in the
 * checkpointer until `resume()` is called.
 */
export async function startTriage(opts: TriageOptions = {}): Promise<TriageSession> {
  const deps = opts.deps ?? realDeps();
  const graph = buildTriageGraph(deps);
  const threadId = opts.threadId ?? `triage-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  const first = await graph.invoke(
    {
      repo: opts.repo ?? DEFAULT_REPO,
      limit: opts.limit ?? 20,
      apply: opts.apply ?? false,
    },
    config,
  );

  if (!isInterrupted<ReviewRequest>(first)) {
    throw new Error(
      "Graph finished without interrupting — the human-in-the-loop step did not run.",
    );
  }
  const review = first[INTERRUPT][0].value as ReviewRequest;

  return {
    threadId,
    review,
    proposals: review.proposals,
    async resume(decisions: Decision[]) {
      const done = await graph.invoke(new Command({ resume: decisions }), config);
      return {
        actions: (done.actions ?? []) as PlannedAction[],
        decisions: (done.decisions ?? []) as Decision[],
      };
    },
  };
}
