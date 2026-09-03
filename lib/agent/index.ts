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

/** Extra knobs for `TriageSession.resume`. */
export type ResumeOptions = {
  /**
   * Flip `apply` at resume time rather than at start.
   *
   * The CLI decides dry-run-vs-apply before the graph ever runs (`--apply`),
   * because there is one human at one terminal. The dashboard cannot: the owner
   * only knows whether these particular writes are worth making AFTER seeing the
   * proposals, which is the entire point of the interrupt. So the resume carries
   * `Command({ resume, update: { apply } })`, which writes the `apply` channel
   * before the pending `apply_decisions` task re-runs and reads it.
   *
   * Omit it and the value chosen at start stands — which is `false`. Dry-run
   * stays the default in every path.
   */
  apply?: boolean;
};

export type TriageSession = {
  threadId: string;
  /** What the human is being asked to decide. */
  review: ReviewRequest;
  proposals: Proposal[];
  /** Resume the halted graph with the human's decisions. */
  resume(
    decisions: Decision[],
    opts?: ResumeOptions,
  ): Promise<{ actions: PlannedAction[]; decisions: Decision[] }>;
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
    async resume(decisions: Decision[], resumeOpts: ResumeOptions = {}) {
      // Two calls rather than one call with a conditional Command: `Command`'s
      // node-name generic is inferred from the params object, so a ternary
      // produces a union of two Command types that `invoke` will not accept.
      // `update` is omitted entirely when the caller said nothing, so a plain
      // resume() behaves exactly as it did before this option existed.
      const done =
        resumeOpts.apply === undefined
          ? await graph.invoke(new Command({ resume: decisions }), config)
          : await graph.invoke(
              new Command({ resume: decisions, update: { apply: resumeOpts.apply } }),
              config,
            );
      return {
        actions: (done.actions ?? []) as PlannedAction[],
        decisions: (done.decisions ?? []) as Decision[],
      };
    },
  };
}
