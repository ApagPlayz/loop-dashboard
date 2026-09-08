/**
 * Staleness reconciliation for the APPROVED queue — audit finding C4.
 *
 * The finding, in full: *"Approved issues never expire; nothing reconciles the
 * queue against reality. Stale approvals accumulate as live landmines."* An
 * idea gets approved on a Tuesday, the owner (or Claude, working with them)
 * hand-builds half of it on the Thursday, and the queue never notices. The
 * Builder's selection rule is "the OLDEST open issue labeled `approved` always
 * wins", so the oldest — and therefore most likely to have been overtaken —
 * approval is precisely the one that gets built.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO
 * ----------------------------------------------------
 * It FLAGS. It adds a `stale` label and posts a comment saying, in concrete
 * terms, what landed since the approval. It never closes an issue, never moves
 * it to `redraft`, never un-approves it. The owner decides; `redraft` is their
 * one-click next step. A commit touching a file an idea mentions is EVIDENCE
 * that the idea may have been overtaken — it is not proof, and every comment
 * this feature posts has to say so.
 *
 * TWO TIERS, MIRRORING THE SCOUT'S OWN CHEAP-GATE-THEN-THINK SHAPE
 * ----------------------------------------------------------------
 *   Tier 1 (this file, deterministic and free): how many commits landed on the
 *     default branch since the approval, were they written by a human or by
 *     the loop, and did any of them touch a path the idea itself cites. This
 *     NARROWS the set. It never decides anything.
 *   Tier 2 (a model, only for what tier 1 hands it): read the actual code and
 *     answer the question tier 1 cannot — is this idea still worth building,
 *     or has it already been built? Running a model over every approved idea
 *     every hour is the cost this two-tier split exists to avoid.
 *
 * WHERE IT RUNS
 * -------------
 * The Next.js app has no working cron (vercel.json is gone, the EventBridge
 * replacement is not built), so the automatic path is a gate inside the Scout's
 * existing hourly GitHub Actions run — see the `stale-check` job in
 * `config/loop-template/workflows/claude-scout.yml`, which implements the same
 * gate and the same tier-1 rule in bash because it runs inside the target repo
 * with no access to this codebase. The constants and thresholds below are the
 * contract between the two; change one and change the other.
 *
 * This file is what the DASHBOARD uses: it powers the read-only "what would it
 * flag right now" preview on the Scout settings panel, so the owner can see
 * the check's answer without waiting for the top of the hour, and can sanity
 * check it before switching the writing half on.
 */

import {
  getCommitFiles,
  getDefaultBranchHead,
  getOctokit,
  listCommitsSince,
  listIssueEvents,
  type RepoConfig,
  type RepoCommit,
} from "./github";
import type { IdeaSummary } from "./queues";

/* ------------------------------------------------------------------ */
/* The contract with claude-scout.yml                                  */
/* ------------------------------------------------------------------ */

/** The warning worn on top of `approved`. Never a queue state of its own. */
export const STALE_LABEL = "stale";

/**
 * Hidden marker on every comment this feature posts.
 *
 * It does two jobs. It lets the workflow find its own previous comments
 * without pattern-matching prose that a model wrote (and will phrase
 * differently every time), and it is how "when did the check last run" is
 * derived — see {@link resolveLastCheckedAt}.
 */
export const STALE_COMMENT_MARKER = "<!-- loop:stale-check -->";

/**
 * A single human commit since approval is enough to make an idea a CANDIDATE.
 * Not to flag it — to look at it. The bar for flagging is tier 2 reading the
 * code and agreeing.
 */
export const MIN_HUMAN_COMMITS = 1;

/**
 * How many human commits it takes to make an idea a candidate when we cannot
 * judge relatedness at all — because the idea cites no file paths, or because
 * we could not read what the commits touched.
 *
 * Five is a judgement call, and the reasoning is worth writing down: an idea
 * that cites no paths has no evidence floor to check against, and silently
 * exempting it would mean the WORST-specified approvals are the only ones that
 * can never be flagged. That is exactly backwards. So they get looked at, but
 * only once there is enough hand-written change for "the product moved under
 * this" to be a reasonable thing to ask a model about.
 */
export const VOLUME_ONLY_THRESHOLD = 5;

/** Hard ceiling on commits read per idea. See listCommitsSince's `max`. */
export const MAX_COMMITS_INSPECTED = 60;

/**
 * Hard ceiling on per-commit file lookups in one assessment pass, shared
 * across every idea being assessed (a cache means the same commit is only ever
 * fetched once). Each lookup is its own API call, so an unbounded version
 * would turn one preview into hundreds of requests against a rate limit the
 * whole dashboard shares. When the budget runs out, relatedness degrades to
 * "unknown" and the volume rule takes over — it never silently reads as
 * "unrelated", because that would quietly clear ideas we simply didn't look at.
 */
export const MAX_FILE_LOOKUPS = 40;

/* ------------------------------------------------------------------ */
/* Who wrote this commit?                                              */
/* ------------------------------------------------------------------ */

/**
 * True when a commit was written by the loop rather than by a person.
 *
 * This is a deliberate port of the awk heuristic already in the Scout's gate
 * step (`claude-scout.yml`, "Recent commit history"), which tags each log line
 * `[HUMAN]` or `[loop]` by matching the lower-cased author name and email
 * against the same four patterns. It is reused rather than reinvented so the
 * two halves of this feature cannot disagree about who wrote what.
 *
 * It is a heuristic and it can be wrong in both directions: a person whose
 * GitHub display name contains "claude" reads as the loop, and a bot with a
 * novel identity reads as a person. Being wrong is not free — a loop commit
 * misread as human is a false stale flag — but it is recoverable, because
 * nothing is auto-actioned on the strength of it.
 */
export function isLoopCommitAuthor(
  authorName: string,
  authorEmail: string,
  authorLogin?: string | null,
): boolean {
  const who = `${authorName} ${authorEmail} ${authorLogin ?? ""}`.toLowerCase();
  return (
    who.includes("claude") ||
    who.includes("github-actions") ||
    who.includes("[bot]") ||
    who.includes("anthropic")
  );
}

/* ------------------------------------------------------------------ */
/* When was this idea approved?                                        */
/* ------------------------------------------------------------------ */

export type ApprovedAtSource = "label-event" | "updated-at" | "created-at";

/**
 * When an idea became `approved`, plus an honest account of how well we know.
 *
 * `precise` is the field that matters. There is exactly one source that really
 * answers the question (the `labeled` event GitHub records when the label goes
 * on), and two fallbacks that answer a DIFFERENT question and are being used
 * because nothing better is available. Anything that renders or reasons about
 * this must carry the caveat through — a comment posted on the owner's issue
 * that says "approved on 12 Aug" when we actually mean "last touched on 12
 * Aug" is the kind of quiet inaccuracy that makes a whole feature untrustable.
 */
export type ApprovedAt = {
  /** ISO timestamp. */
  at: string;
  source: ApprovedAtSource;
  /** True only for `label-event`. */
  precise: boolean;
  /** One sentence naming the limitation, empty when `precise`. */
  caveat: string;
};

/**
 * Resolve the approval moment from an issue's event log, falling back to the
 * issue's own timestamps.
 *
 * The LATEST `labeled: approved` event wins, not the earliest. An idea that
 * was approved, un-approved after a rethink, and approved again a month later
 * was only approved-as-it-stands-now on that second date; measuring from the
 * first would count a month of unrelated commits against it.
 *
 * Fallbacks, and which way each one is wrong:
 *   - `updated-at` — the last time ANYTHING happened to the issue (a comment,
 *     an edit, a different label). It is at or after the real approval, so the
 *     window it produces is too SHORT: this under-flags. That is the right
 *     direction to be wrong in, which is why it is preferred over createdAt.
 *   - `created-at` — when the idea was filed, which is at or before approval,
 *     so the window is too LONG: this over-flags. Last resort.
 */
export function resolveApprovedAt(
  events: Array<{ event: string; label: string | null; createdAt: string }>,
  idea: { createdAt: string; updatedAt: string },
): ApprovedAt {
  const labelAdds = events
    .filter(
      (e) =>
        e.event === "labeled" &&
        e.label === "approved" &&
        isUsableTimestamp(e.createdAt),
    )
    .map((e) => e.createdAt)
    .sort();

  const latest = labelAdds[labelAdds.length - 1];
  if (latest) {
    return { at: latest, source: "label-event", precise: true, caveat: "" };
  }

  if (isUsableTimestamp(idea.updatedAt)) {
    return {
      at: idea.updatedAt,
      source: "updated-at",
      precise: false,
      caveat:
        "GitHub had no record of when the `approved` label was added, so this " +
        "measures from when the issue was last touched instead. That is at or " +
        "after the real approval, so if anything this looks at too FEW commits, " +
        "not too many.",
    };
  }

  return {
    at: idea.createdAt,
    source: "created-at",
    precise: false,
    caveat:
      "Neither the label history nor a usable last-updated time was available, " +
      "so this measures from when the idea was filed. Approval came at or after " +
      "that, so this window is too WIDE — some of the commits counted may predate " +
      "the approval entirely.",
  };
}

function isUsableTimestamp(value: string | null | undefined): boolean {
  if (!value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

/* ------------------------------------------------------------------ */
/* The interval gate                                                   */
/* ------------------------------------------------------------------ */

export type IntervalGate = {
  due: boolean;
  /** Hours since the last check, or null when there has never been one. */
  hoursSince: number | null;
  /** ISO timestamp of the next check, or null when one is due now. */
  nextDueAt: string | null;
  reason: string;
};

/**
 * Has enough time passed since the last check?
 *
 * This is a gate INSIDE the Scout's existing hourly run, not a schedule. There
 * is no cron in the dashboard to hang a second schedule off, and adding one to
 * the target repos would mean a new workflow file to roll out by hand to every
 * project. The hourly run already exists; this decides whether it does the
 * work when it fires.
 *
 * `lastCheckedAt` is DERIVED, never stored — see {@link resolveLastCheckedAt}
 * for why, and for the one case that derivation gets wrong.
 */
export function isStaleCheckDue(
  lastCheckedAt: string | null,
  intervalHours: number,
  now: Date = new Date(),
): IntervalGate {
  const interval = Math.max(1, Math.floor(intervalHours) || 1);

  if (!isUsableTimestamp(lastCheckedAt)) {
    return {
      due: true,
      hoursSince: null,
      nextDueAt: null,
      reason:
        "No previous stale check found on this repo — running one now.",
    };
  }

  const last = Date.parse(lastCheckedAt as string);
  const hoursSince = (now.getTime() - last) / 3_600_000;

  // A last-checked stamp in the future is nonsense data (a clock skew, or a
  // comment whose timestamp we misread). Treat it as "no usable record" and
  // run, rather than letting one bad value wedge the feature off until the
  // date passes. Re-flagging is already prevented by the `stale` label, so the
  // cost of running too often is a few free API calls, not comment spam.
  if (hoursSince < 0) {
    return {
      due: true,
      hoursSince: null,
      nextDueAt: null,
      reason:
        "The last recorded stale check is dated in the future — ignoring it and running now.",
    };
  }

  if (hoursSince >= interval) {
    return {
      due: true,
      hoursSince,
      nextDueAt: null,
      reason: `Last checked ${formatHours(hoursSince)} ago (interval: every ${interval}h) — running now.`,
    };
  }

  return {
    due: false,
    hoursSince,
    nextDueAt: new Date(last + interval * 3_600_000).toISOString(),
    reason: `Last checked ${formatHours(hoursSince)} ago; the interval is every ${interval}h — nothing to do this run.`,
  };
}

/* ------------------------------------------------------------------ */
/* Tier 1 — the deterministic narrowing rule                           */
/* ------------------------------------------------------------------ */

/** One commit, with everything tier 1 needs to reason about it. */
export type CommitEvidence = {
  sha: string;
  shortSha: string;
  committedAt: string;
  author: string;
  /** False when {@link isLoopCommitAuthor} matched. */
  isHuman: boolean;
  subject: string;
  /**
   * Paths this commit touched. An EMPTY array means "we did not look", not
   * "it touched nothing" — the file-lookup budget is finite. Tier 1 treats it
   * as unknown, never as evidence of unrelatedness.
   */
  files: string[];
};

/**
 * Whether the commits since approval plausibly bear on this idea.
 *   - `related`   — a human commit touched a path the idea itself cites.
 *   - `unrelated` — we read what every human commit touched, and none of it
 *                   went near anything the idea cites.
 *   - `unknown`   — the idea cites no paths, or we could not read the files.
 */
export type Relatedness = "related" | "unrelated" | "unknown";

export type Tier1Verdict = {
  /** Worth spending a model call on. NOT "this is stale". */
  candidate: boolean;
  humanCommits: number;
  loopCommits: number;
  relatedness: Relatedness;
  /** Changed paths that matched something the idea cites. */
  matchedPaths: string[];
  /** File paths the idea's own text points at. */
  citedPaths: string[];
  /** Plain-English account of the arithmetic, for the log and the comment. */
  reason: string;
};

/**
 * File paths an idea's text points at.
 *
 * The Scout's evidence floor REQUIRES every proposal to quote a concrete
 * `path:line` from the repo, so on a healthy queue this almost always finds
 * something — and when it finds nothing, that is itself information (the idea
 * was filed by hand, or predates the evidence floor).
 *
 * A slash is required. `package.json` on its own is a real citation but it is
 * also a word that appears in half of all prose about software, and treating
 * every bare filename as a path hint made nearly every idea "related" to
 * nearly every commit. Requiring a slash costs a few true matches and removes
 * most of the false ones.
 */
export function extractCitedPaths(text: string): string[] {
  if (!text) return [];
  // URLs go FIRST, whole. Stripping them afterwards does not work: the scheme
  // ("https:") is not made of path characters, so the regex below never sees
  // it and happily lifts "example.com/blog/post" out of a link as if it were a
  // repo path. Ideas cite external sources constantly — the Scout's evidence
  // floor asks for them — so this is the common case, not the edge case.
  const prose = text.replace(/https?:\/\/[^\s)>"'\]]*/gi, " ");
  const out = new Set<string>();
  // A run of path segments with at least one slash, optionally ending in a
  // filename. Trailing ":123" (the line-number half of a `path:line` citation)
  // and a trailing slash are trimmed by normalizePath.
  const re = /(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]*/g;
  for (const raw of prose.match(re) ?? []) {
    const cleaned = normalizePath(raw);
    if (!cleaned) continue;
    if (cleaned.startsWith("node_modules/")) continue;
    if (!cleaned.includes("/")) continue;
    out.add(cleaned);
  }
  return [...out];
}

function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/^[`'"(\[<]+/, "")
    .replace(/[`'")\]>,.;]+$/, "")
    .replace(/:\d+(?::\d+)?$/, "") // strip the ":123" of a path:line citation
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    // `src/auth/` and `src/auth` are the same place; storing both would double
    // every comparison and report the same match twice.
    .replace(/\/+$/, "");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function baseOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * Is `changed` plausibly the same part of the codebase as `cited`?
 *
 * Deliberately generous — it is a narrowing filter feeding a model that will
 * read the actual code, not a verdict. Being too tight here means an idea that
 * really was overtaken never even gets looked at, which is the failure the
 * whole feature exists to fix. Being too loose costs one model call.
 */
export function pathsRelated(cited: string, changed: string): boolean {
  const a = normalizePath(cited).toLowerCase();
  const b = normalizePath(changed).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  // A cited directory containing the changed file (or the reverse, when the
  // idea cites a file inside a directory the commit rewrote wholesale).
  if (b.startsWith(a.endsWith("/") ? a : `${a}/`)) return true;
  if (a.startsWith(b.endsWith("/") ? b : `${b}/`)) return true;
  // Same folder.
  const da = dirOf(a);
  const db = dirOf(b);
  if (da && da === db) return true;
  if (da && b.startsWith(`${da}/`)) return true;
  // Same filename in a different place — a moved or renamed file.
  if (baseOf(a) && baseOf(a) === baseOf(b) && baseOf(a).includes(".")) return true;
  return false;
}

/**
 * Tier 1. Given an approved idea and the commits that landed after it was
 * approved, decide whether it is worth asking a model about.
 *
 * The rule, in one place:
 *   1. Discard loop-authored commits — they are this system talking to itself,
 *      and they are already represented in the queue.
 *   2. Fewer than {@link MIN_HUMAN_COMMITS} human commits → not a candidate.
 *      Nothing has changed under this idea.
 *   3. If the idea cites paths AND we know what the commits touched: a
 *      candidate only if at least one human commit touched a related path.
 *   4. If we cannot judge relatedness (no cited paths, or unread file lists):
 *      a candidate once there are {@link VOLUME_ONLY_THRESHOLD} human commits.
 */
export function evaluateTier1(
  idea: { title: string; body: string },
  commits: CommitEvidence[],
  approvedAt: ApprovedAt,
): Tier1Verdict {
  const since = commits.filter(
    (c) => !isUsableTimestamp(c.committedAt) || c.committedAt > approvedAt.at,
  );
  const human = since.filter((c) => c.isHuman);
  const loopCommits = since.length - human.length;
  const citedPaths = extractCitedPaths(`${idea.title}\n${idea.body}`);

  if (human.length < MIN_HUMAN_COMMITS) {
    return {
      candidate: false,
      humanCommits: human.length,
      loopCommits,
      relatedness: "unknown",
      matchedPaths: [],
      citedPaths,
      reason: `No hand-written commits have landed since ${describeApprovedAt(approvedAt)}${
        loopCommits > 0 ? ` (${loopCommits} loop commit${plural(loopCommits)}, which don't count)` : ""
      }.`,
    };
  }

  const matched = new Set<string>();
  let anyFilesUnknown = false;
  for (const c of human) {
    if (c.files.length === 0) {
      anyFilesUnknown = true;
      continue;
    }
    for (const f of c.files) {
      if (citedPaths.some((p) => pathsRelated(p, f))) matched.add(f);
    }
  }

  let relatedness: Relatedness;
  if (citedPaths.length === 0) {
    relatedness = "unknown";
  } else if (matched.size > 0) {
    relatedness = "related";
  } else if (anyFilesUnknown) {
    relatedness = "unknown";
  } else {
    relatedness = "unrelated";
  }

  const matchedPaths = [...matched].sort();
  const candidate =
    relatedness === "related" ||
    (relatedness === "unknown" && human.length >= VOLUME_ONLY_THRESHOLD);

  return {
    candidate,
    humanCommits: human.length,
    loopCommits,
    relatedness,
    matchedPaths,
    citedPaths,
    reason: describeTier1(human.length, loopCommits, relatedness, matchedPaths, approvedAt, candidate),
  };
}

function describeTier1(
  humanCommits: number,
  loopCommits: number,
  relatedness: Relatedness,
  matchedPaths: string[],
  approvedAt: ApprovedAt,
  candidate: boolean,
): string {
  const head = `${humanCommits} hand-written commit${plural(humanCommits)} landed on the default branch since ${describeApprovedAt(approvedAt)}${
    loopCommits > 0 ? `, plus ${loopCommits} from the loop itself (not counted)` : ""
  }`;

  if (relatedness === "related") {
    const shown = matchedPaths.slice(0, 5).join(", ");
    const more = matchedPaths.length > 5 ? ` and ${matchedPaths.length - 5} more` : "";
    return `${head}, and ${matchedPaths.length === 1 ? "one of them touched" : "they touched"} ${shown}${more} — path${plural(matchedPaths.length)} this idea itself points at.`;
  }
  if (relatedness === "unrelated") {
    return `${head}, but none of them went near the files this idea points at.`;
  }
  return `${head}. This idea doesn't point at any specific files (or their contents couldn't be read), so there's no way to tell from commits alone whether they bear on it${
    candidate ? " — flagged on volume alone" : ""
  }.`;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/** "12 Aug 2026", or "when it was approved" when the date is unusable. */
export function formatDay(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "an unknown date";
  const d = new Date(t);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "it was approved on 12 Aug 2026" / "it was last touched on 12 Aug 2026". */
export function describeApprovedAt(approvedAt: ApprovedAt): string {
  const day = formatDay(approvedAt.at);
  switch (approvedAt.source) {
    case "label-event":
      return `it was approved on ${day}`;
    case "updated-at":
      return `it was last touched on ${day} (the approval date itself isn't recorded)`;
    case "created-at":
      return `it was filed on ${day} (neither the approval date nor a last-touched date was available)`;
  }
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minute${plural(Math.round(hours * 60))}`;
  if (hours < 48) return `${Math.round(hours)} hour${plural(Math.round(hours))}`;
  return `${Math.round(hours / 24)} day${plural(Math.round(hours / 24))}`;
}

/* ------------------------------------------------------------------ */
/* Deriving "when did this last run"                                   */
/* ------------------------------------------------------------------ */

/**
 * When the stale check last posted anything on this repo.
 *
 * DERIVED, not stored, and that is the point: the alternative was writing a
 * timestamp file into the target repo on every hourly run, which is a commit
 * an hour of pure churn on a repo whose git history the rest of this loop now
 * reads as a signal. Poisoning that signal to record when we last looked at it
 * would be self-defeating.
 *
 * The one thing this gets wrong, stated plainly: a check that runs and finds
 * NOTHING stale posts nothing, so it leaves no trace and the derived
 * last-checked time does not move. The interval therefore only really throttles
 * runs that found something. That is the correct thing to throttle — tier 1 is
 * free (a handful of API calls and no model), and what the interval exists to
 * bound is repeated model calls and repeated comments on the owner's issues.
 *
 * The other candidate signal, the last workflow run via `gh run list`, was
 * rejected for the opposite reason: the Scout runs hourly regardless, so its
 * last run is always about an hour ago and the gate would never close.
 */
export async function resolveLastCheckedAt(
  repo: RepoConfig,
): Promise<string | null> {
  try {
    const res = await getOctokit().rest.issues.listCommentsForRepo({
      owner: repo.owner,
      repo: repo.repo,
      sort: "created",
      direction: "desc",
      per_page: 100,
    });
    for (const c of res.data) {
      if ((c.body ?? "").includes(STALE_COMMENT_MARKER)) {
        return c.created_at ?? null;
      }
    }
    return null;
  } catch {
    // A failed lookup must read as "we don't know", which opens the gate. Tier
    // 1 is free, so an extra pass costs nothing; a closed gate would silently
    // switch the feature off.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The read-only assessment the dashboard renders                      */
/* ------------------------------------------------------------------ */

export type StaleAssessment = {
  number: number;
  title: string;
  htmlUrl: string;
  approvedAt: ApprovedAt;
  verdict: Tier1Verdict;
  /** Already carries the `stale` label — the Scout has flagged it before. */
  alreadyFlagged: boolean;
  /** The human commits tier 1 counted, newest first, capped for display. */
  commits: CommitEvidence[];
};

export type StalePreview = {
  /** Whether `scout.staleCheck.enabled` is on for this project. */
  enabled: boolean;
  intervalHours: number;
  /** The default branch this was measured against, null on an empty repo. */
  branch: string | null;
  lastCheckedAt: string | null;
  gate: IntervalGate;
  /** When this preview itself ran. */
  checkedAt: string;
  /** Every open approved idea, candidates first. */
  ideas: StaleAssessment[];
};

/**
 * Run tier 1 over a set of approved ideas. Read-only: nothing here labels,
 * comments, or closes anything. That is the Scout's job, deliberately — this
 * is the preview that lets the owner see the rule's answer before they let it
 * write to their repo.
 */
export async function assessApprovedIdeas(
  ideas: IdeaSummary[],
  repo: RepoConfig,
  opts: { fileLookupBudget?: number } = {},
): Promise<{ branch: string | null; assessments: StaleAssessment[] }> {
  const head = await getDefaultBranchHead(repo);
  if (!head || ideas.length === 0) {
    return { branch: head?.branch ?? null, assessments: [] };
  }

  let budget = opts.fileLookupBudget ?? MAX_FILE_LOOKUPS;
  // One commit can be relevant to several ideas; fetch its file list once.
  const fileCache = new Map<string, string[]>();

  const assessments: StaleAssessment[] = [];
  for (const idea of ideas) {
    const events = await listIssueEvents(idea.number, repo).catch(() => []);
    const approvedAt = resolveApprovedAt(events, idea);

    const raw = await listCommitsSince(approvedAt.at, repo, {
      branch: head.branch,
      max: MAX_COMMITS_INSPECTED,
    });

    const commits: CommitEvidence[] = [];
    for (const c of raw) {
      const isHuman = !isLoopCommitAuthor(c.authorName, c.authorEmail, c.authorLogin);
      let files = fileCache.get(c.sha) ?? [];
      // Only human commits are ever weighed, so only they are worth a lookup.
      if (isHuman && !fileCache.has(c.sha) && budget > 0) {
        budget--;
        files = await getCommitFiles(c.sha, repo);
        fileCache.set(c.sha, files);
      }
      commits.push(toEvidence(c, isHuman, files));
    }

    assessments.push({
      number: idea.number,
      title: idea.title,
      htmlUrl: idea.htmlUrl,
      approvedAt,
      verdict: evaluateTier1(idea, commits, approvedAt),
      alreadyFlagged: idea.labels.includes(STALE_LABEL),
      commits: commits.filter((c) => c.isHuman).slice(0, 10),
    });
  }

  // Candidates first, then most-changed-under first: the order the owner would
  // want to read them in.
  assessments.sort((a, b) => {
    if (a.verdict.candidate !== b.verdict.candidate) return a.verdict.candidate ? -1 : 1;
    return b.verdict.humanCommits - a.verdict.humanCommits;
  });

  return { branch: head.branch, assessments };
}

function toEvidence(c: RepoCommit, isHuman: boolean, files: string[]): CommitEvidence {
  return {
    sha: c.sha,
    shortSha: c.shortSha,
    committedAt: c.committedAt,
    author: c.authorName || c.authorLogin || "unknown",
    isHuman,
    subject: c.subject,
    files,
  };
}
