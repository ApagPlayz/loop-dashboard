/**
 * Shared types for the backlog-triage agent.
 *
 * Deliberately free of Next.js (and of any `@/` path alias) so this directory
 * can be lifted out and deployed to AWS Bedrock AgentCore Runtime unchanged.
 */

/** Minimal repo coordinates — matches `RepoConfig` in lib/github.ts. */
export type RepoConfig = { owner: string; repo: string };

/** One open issue pulled off the backlog. */
export type BacklogItem = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: string;
  url: string;
};

/** What the model may recommend for an item. */
export type Recommendation = "approve" | "decline" | "needs-info";

/** The model's verdict on a single item. */
export type Assessment = {
  number: number;
  recommendation: Recommendation;
  /** One line. Why this verdict. */
  reason: string;
  /** 0..1 */
  confidence: number;
};

/** An assessment joined back onto the item it belongs to. */
export type Proposal = BacklogItem & {
  recommendation: Recommendation;
  reason: string;
  confidence: number;
};

/** What the human sends back to resume the graph. */
export type Decision = {
  number: number;
  /** `skip` = do nothing at all for this item. */
  action: Recommendation | "skip";
  /** Optional override note; used as the comment body for `needs-info`. */
  note?: string;
};

/** A concrete GitHub write (or, in dry-run, the write we *would* have made). */
export type PlannedAction = {
  number: number;
  kind: "add-label" | "comment" | "none";
  /** Label name, or comment body. */
  detail: string;
  /** Human-readable one-liner for the dry-run printout. */
  summary: string;
  /** True only when we actually called GitHub. */
  applied: boolean;
  /** Set when an apply attempt threw. */
  error?: string;
};

/** The payload handed to the human when the graph halts. */
export type ReviewRequest = {
  kind: "triage-review";
  repo: RepoConfig;
  proposals: Proposal[];
};

/** Accepted shapes for `new Command({ resume })`. */
export type ResumeValue = Decision[] | { decisions: Decision[] };

/**
 * Everything the graph needs from the outside world. Injected rather than
 * imported so tests can run with zero network and zero LLM.
 */
export type TriageDeps = {
  /** Fetch open issues from the target repo. */
  listBacklog(repo: RepoConfig, limit: number): Promise<BacklogItem[]>;
  /** Assess a *batch* of items in one LLM call. */
  assessBatch(items: BacklogItem[]): Promise<Assessment[]>;
  /** Perform one GitHub write. Only ever called when `apply` is true. */
  applyAction(repo: RepoConfig, action: PlannedAction): Promise<void>;
};
