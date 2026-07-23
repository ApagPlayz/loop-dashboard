/**
 * Shared server-side helpers and types for the Ideas queue (/ideas) and the
 * Builds & Evidence station (/builds).
 *
 * These extend lib/github.ts (which we must not edit) by calling getOctokit()
 * directly for the endpoints the base helpers don't expose: issue-comment
 * listing, PR details/files, and PR closing. Everything here runs on the
 * server (API routes / server components) where GITHUB_TOKEN is available.
 */

import { getOctokit, REPOS, type RepoConfig } from "@/lib/github";
import { loadEvidenceManifest, readEvidenceFile } from "@/lib/queues-evidence";

const { owner, repo } = REPOS.primary;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** A Scout proposal / idea (a GitHub issue that is not a PR). */
export type IdeaSummary = {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  labels: string[];
  author: string;
  authorAvatar: string;
  state: "open" | "closed";
  closedAt: string | null;
  stateReason: string | null;
};

/** The four Ideas tabs, each with its issues. */
export type IdeasPayload = {
  waiting: IdeaSummary[]; // proposal
  approved: IdeaSummary[]; // approved
  redraft: IdeaSummary[]; // redraft
  closed: IdeaSummary[]; // recently closed that carried one of the above labels
};

/** A single comment on an issue or PR. */
export type ThreadComment = {
  id: number;
  author: string;
  authorAvatar: string;
  body: string;
  createdAt: string;
  htmlUrl: string;
  isBot: boolean;
};

/** Lightweight PR row for the Builds tabs. */
export type PRSummary = {
  number: number;
  title: string;
  headRef: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  state: "open" | "closed";
  merged: boolean;
  author: string;
  authorAvatar: string;
  draft: boolean;
};

/** The three Builds tabs. */
export type BuildsPayload = {
  needsReview: PRSummary[]; // open PRs from claude/** branches
  merged: PRSummary[]; // recently merged
  closed: PRSummary[]; // recently closed without merging
};

export type VerdictLevel = "SHIP" | "FIX FIRST" | "DO NOT MERGE" | "UNKNOWN";

export type AuditVerdict = {
  verdict: VerdictLevel;
  body: string;
  htmlUrl: string;
  author: string;
  createdAt: string;
} | null;

export type EvidenceItem = {
  file: string;
  type: "screenshot" | "video" | "log" | "audio" | "other";
  caption: string;
};

export type DemoEvidence =
  | { status: "available"; capturedAt: string | null; items: EvidenceItem[] }
  | { status: "comment-only"; commentBody: string; commentUrl: string }
  | { status: "none" };

/** Full detail view for a single PR. */
export type PRDetail = PRSummary & {
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: boolean | null;
  mergeableState: string;
  baseRef: string;
  /**
   * How many commits `baseRef` (main) has that this PR's branch doesn't —
   * i.e. how far behind main the PR is. Best-effort: 0 if we couldn't
   * compute it (closed/merged PRs, or a failed compare call).
   */
  behindBy: number;
  verdict: AuditVerdict;
  demo: DemoEvidence;
  comments: ThreadComment[];
};

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

type RawIssue = {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  labels: Array<string | { name?: string }>;
  user?: { login?: string; avatar_url?: string } | null;
  state: string;
  closed_at?: string | null;
  state_reason?: string | null;
};

function labelNames(labels: RawIssue["labels"]): string[] {
  return labels
    .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
    .filter(Boolean);
}

function mapIssue(i: RawIssue): IdeaSummary {
  return {
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    htmlUrl: i.html_url,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    commentCount: i.comments,
    labels: labelNames(i.labels),
    author: i.user?.login ?? "unknown",
    authorAvatar: i.user?.avatar_url ?? "",
    state: i.state === "closed" ? "closed" : "open",
    closedAt: i.closed_at ?? null,
    stateReason: i.state_reason ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Ideas data                                                          */
/* ------------------------------------------------------------------ */

const IDEA_LABELS = ["proposal", "approved", "redraft"];

/** Load all four Ideas tabs in as few requests as possible. */
export async function loadIdeas(
  repoConfig: RepoConfig = REPOS.primary,
): Promise<IdeasPayload> {
  const octokit = getOctokit();
  const { owner, repo } = repoConfig;

  // One "open" listing covers proposal/approved/redraft (they're all open).
  const openRes = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  const open = openRes.data
    .filter((i) => !i.pull_request)
    .map((i) => mapIssue(i as unknown as RawIssue));

  const has = (idea: IdeaSummary, label: string) =>
    idea.labels.includes(label);

  const waiting = open
    .filter((i) => has(i, "proposal"))
    .sort(byNewest);
  const approved = open
    .filter((i) => has(i, "approved") && !has(i, "proposal"))
    .sort(byNewest);
  const redraft = open
    .filter((i) => has(i, "redraft") && !has(i, "proposal"))
    .sort(byNewest);

  // Recently closed issues that carried one of the queue labels.
  const closedRes = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: "closed",
    per_page: 50,
    sort: "updated",
    direction: "desc",
  });
  const closed = closedRes.data
    .filter((i) => !i.pull_request)
    .map((i) => mapIssue(i as unknown as RawIssue))
    .filter((i) => i.labels.some((l) => IDEA_LABELS.includes(l)))
    .sort(byClosed)
    .slice(0, 10);

  return { waiting, approved, redraft, closed };
}

function byNewest(a: IdeaSummary, b: IdeaSummary) {
  return +new Date(b.createdAt) - +new Date(a.createdAt);
}
function byClosed(a: IdeaSummary, b: IdeaSummary) {
  return +new Date(b.closedAt ?? b.updatedAt) - +new Date(a.closedAt ?? a.updatedAt);
}

/** One issue's current title/body/labels/state — for building AI context. */
export async function getIssue(
  issueNumber: number,
  repoConfig: RepoConfig = REPOS.primary,
): Promise<{ number: number; title: string; body: string; labels: string[]; state: "open" | "closed" }> {
  const res = await getOctokit().rest.issues.get({
    owner: repoConfig.owner,
    repo: repoConfig.repo,
    issue_number: issueNumber,
  });
  return {
    number: res.data.number,
    title: res.data.title,
    body: res.data.body ?? "",
    labels: labelNames(res.data.labels as RawIssue["labels"]),
    state: res.data.state === "closed" ? "closed" : "open",
  };
}

/** List the comment thread for an issue or PR (they share the endpoint). */
export async function listThreadComments(
  issueNumber: number,
  repoConfig: RepoConfig = REPOS.primary,
): Promise<ThreadComment[]> {
  const res = await getOctokit().rest.issues.listComments({
    owner: repoConfig.owner,
    repo: repoConfig.repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  return res.data.map((c) => ({
    id: c.id,
    author: c.user?.login ?? "unknown",
    authorAvatar: c.user?.avatar_url ?? "",
    body: c.body ?? "",
    createdAt: c.created_at,
    htmlUrl: c.html_url,
    isBot: (c.user?.type === "Bot") || (c.user?.login ?? "").endsWith("[bot]"),
  }));
}

/**
 * List formal PR reviews (`gh pr review --comment`) as ThreadComment-shaped
 * entries. The Auditor's prompt says "post ONE review comment," which an
 * agent run can reasonably satisfy either with a plain issue comment
 * (`gh pr comment`) or a formal review (`gh pr review --comment`) — both are
 * valid GitHub objects, but they live in different API endpoints. Without
 * this, a verdict posted the second way is invisible to the dashboard even
 * though it's clearly visible on GitHub itself.
 */
async function listPRReviewComments(
  prNumber: number,
  repoConfig: RepoConfig = REPOS.primary,
): Promise<ThreadComment[]> {
  const res = await getOctokit().rest.pulls.listReviews({
    owner: repoConfig.owner,
    repo: repoConfig.repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return res.data
    .filter((r) => (r.body ?? "").trim().length > 0)
    .map((r) => ({
      id: r.id,
      author: r.user?.login ?? "unknown",
      authorAvatar: r.user?.avatar_url ?? "",
      body: r.body ?? "",
      createdAt: r.submitted_at ?? "",
      htmlUrl: r.html_url,
      isBot: r.user?.type === "Bot" || (r.user?.login ?? "").endsWith("[bot]"),
    }));
}

/** Close an issue (used by the Reject action). */
export async function closeIssue(
  issueNumber: number,
  stateReason: "completed" | "not_planned" = "not_planned",
  repoConfig: RepoConfig = REPOS.primary,
) {
  const res = await getOctokit().rest.issues.update({
    owner: repoConfig.owner,
    repo: repoConfig.repo,
    issue_number: issueNumber,
    state: "closed",
    state_reason: stateReason,
  });
  return res.data;
}

/** Reopen a previously closed issue (used by the Rebuild-fresh action). */
export async function reopenIssue(
  issueNumber: number,
  repoConfig: RepoConfig = REPOS.primary,
) {
  const res = await getOctokit().rest.issues.update({
    owner: repoConfig.owner,
    repo: repoConfig.repo,
    issue_number: issueNumber,
    state: "open",
  });
  return res.data;
}

/* ------------------------------------------------------------------ */
/* Builds / PR data                                                    */
/* ------------------------------------------------------------------ */

type RawPR = {
  number: number;
  title: string;
  head: { ref: string };
  base?: { ref: string };
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  closed_at?: string | null;
  state: string;
  draft?: boolean;
  user?: { login?: string; avatar_url?: string } | null;
};

function mapPR(p: RawPR, merged: boolean): PRSummary {
  return {
    number: p.number,
    title: p.title,
    headRef: p.head.ref,
    htmlUrl: p.html_url,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    mergedAt: p.merged_at ?? null,
    closedAt: p.closed_at ?? null,
    state: p.state === "closed" ? "closed" : "open",
    merged,
    author: p.user?.login ?? "unknown",
    authorAvatar: p.user?.avatar_url ?? "",
    draft: Boolean(p.draft),
  };
}

const isBuilderBranch = (ref: string) => ref.startsWith("claude/");

/** Load the three Builds tabs. */
export async function loadBuilds(): Promise<BuildsPayload> {
  const octokit = getOctokit();
  const res = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "all",
    per_page: 100,
    sort: "updated",
    direction: "desc",
  });
  const prs = res.data as unknown as RawPR[];

  const needsReview = prs
    .filter((p) => p.state === "open" && isBuilderBranch(p.head.ref) && !p.draft)
    .map((p) => mapPR(p, false))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const merged = prs
    .filter((p) => p.state === "closed" && p.merged_at)
    .map((p) => mapPR(p, true))
    .sort(
      (a, b) => +new Date(b.mergedAt ?? 0) - +new Date(a.mergedAt ?? 0),
    )
    .slice(0, 15);

  const closed = prs
    .filter((p) => p.state === "closed" && !p.merged_at)
    .map((p) => mapPR(p, false))
    .sort(
      (a, b) => +new Date(b.closedAt ?? 0) - +new Date(a.closedAt ?? 0),
    )
    .slice(0, 15);

  return { needsReview, merged, closed };
}

/** Full PR detail: stats, comments, audit verdict, and demo evidence. */
export async function loadPRDetail(prNumber: number): Promise<PRDetail> {
  const octokit = getOctokit();

  const prRes = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  const p = prRes.data;

  const [issueComments, reviewComments] = await Promise.all([
    listThreadComments(prNumber),
    listPRReviewComments(prNumber),
  ]);
  const comments = [...issueComments, ...reviewComments].sort(
    (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
  );
  const verdict = parseAuditFromComments(comments);
  const demo = await resolveDemoEvidence(prNumber, p.head.sha, comments);
  const behindBy =
    p.state === "open" ? await countCommitsBehindMain(p.base?.ref, p.head?.ref) : 0;

  return {
    ...mapPR(p as unknown as RawPR, Boolean(p.merged)),
    body: p.body ?? "",
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    changedFiles: p.changed_files ?? 0,
    mergeable: p.mergeable,
    mergeableState: p.mergeable_state ?? "unknown",
    baseRef: p.base?.ref ?? "main",
    behindBy,
    verdict,
    demo,
    comments,
  };
}

/**
 * Best-effort: how many commits `baseRef` (main) has that `headRef` (the PR
 * branch) doesn't yet — i.e. how far behind main the PR is getting. Used to
 * show an early "falling behind" warning before it turns into a hard
 * conflict. Never throws; returns 0 on any error so a flaky compare call
 * can't break the PR card.
 */
async function countCommitsBehindMain(
  baseRef: string | undefined,
  headRef: string | undefined,
): Promise<number> {
  if (!baseRef || !headRef) return 0;
  try {
    const res = await getOctokit().rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseRef}...${headRef}`,
    });
    return res.data.behind_by ?? 0;
  } catch {
    return 0;
  }
}

/** Close a PR without merging. */
export async function closePR(prNumber: number) {
  const res = await getOctokit().rest.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    state: "closed",
  });
  return res.data;
}

/* ------------------------------------------------------------------ */
/* Audit-verdict parsing                                               */
/* ------------------------------------------------------------------ */

/**
 * The Auditor (posted by `claude[bot]`) leaves a comment whose header reads
 * like "## 🔍 Adversarial audit — PR #NN" and which contains a line such as:
 *   **Verdict:** ✅ **SHIP**
 *   **Verdict: SHIP** ✅ (with a few non-blocking follow-ups)
 *   **Verdict:** FIX FIRST
 *   **Verdict:** DO NOT MERGE
 * We find the newest audit comment and read the verdict keyword.
 */
export function classifyVerdict(body: string): VerdictLevel {
  const m = body.match(/verdict[:*\s]*([^\n]{0,60})/i);
  const window = (m ? m[1] : body).toUpperCase();
  const check = (s: string) => {
    if (/DO\s*NOT\s*MERGE/.test(s)) return "DO NOT MERGE" as const;
    if (/FIX\s*FIRST/.test(s)) return "FIX FIRST" as const;
    if (/\bSHIP\b/.test(s)) return "SHIP" as const;
    return null;
  };
  return check(window) ?? check(body.toUpperCase()) ?? "UNKNOWN";
}

function isAuditComment(c: ThreadComment): boolean {
  return c.isBot && /adversarial audit/i.test(c.body);
}

export function parseAuditFromComments(comments: ThreadComment[]): AuditVerdict {
  const audits = comments
    .filter(isAuditComment)
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  if (audits.length === 0) return null;
  const latest = audits[audits.length - 1];
  return {
    verdict: classifyVerdict(latest.body),
    body: latest.body,
    htmlUrl: latest.htmlUrl,
    author: latest.author,
    createdAt: latest.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Demo evidence                                                       */
/* ------------------------------------------------------------------ */

/** The "📸 Demo evidence" PR comment, if the Demo agent posted one. */
function findDemoComment(comments: ThreadComment[]): ThreadComment | null {
  const hits = comments.filter(
    (c) => c.isBot && /demo evidence/i.test(c.body),
  );
  return hits.length ? hits[hits.length - 1] : null;
}

/**
 * Decide what demo evidence we can show for a PR:
 *  - "available"    : the artifact exists, is unexpired, and has a manifest.
 *  - "comment-only" : no usable artifact but the Demo agent posted a comment
 *                     (e.g. the 30-day artifact retention expired).
 *  - "none"         : nothing yet.
 */
export async function resolveDemoEvidence(
  prNumber: number,
  _headSha: string,
  comments: ThreadComment[],
): Promise<DemoEvidence> {
  const demoComment = findDemoComment(comments);
  try {
    const manifest = await loadEvidenceManifest(prNumber);
    if (manifest && manifest.items.length > 0) {
      return {
        status: "available",
        capturedAt: manifest.captured_at ?? null,
        items: manifest.items,
      };
    }
  } catch {
    // fall through to comment / none
  }
  if (demoComment) {
    return {
      status: "comment-only",
      commentBody: demoComment.body,
      commentUrl: demoComment.htmlUrl,
    };
  }
  return { status: "none" };
}

/* Re-exported from the evidence module so API routes have a single import. */
export { loadEvidenceManifest, readEvidenceFile };
