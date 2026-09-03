/**
 * Demo fixtures for the Ideas queue, the Builds & Evidence station, the
 * Learnings page, the loop-config panel, and the Claude Code Reporter.
 *
 * ## What this file is
 *
 * An unauthenticated visitor's `GET /api/*` requests never reach the real
 * route handlers in `app/api/**` — the proxy described in
 * `lib/public-access.ts` answers them straight out of the fixture list below
 * and refuses everything else. This file supplies that list for the seven
 * read-only routes the Ideas, Builds, Learnings, Automation and Reporter
 * panels call: `/api/ideas`, `/api/ideas/[number]`, `/api/builds`,
 * `/api/builds/[pr]`, `/api/learnings`, `/api/loop-config` and
 * `/api/reporter`. Every body below is shaped to match its real route's
 * success response field-for-field (checked directly against
 * `app/api/**\/route.ts` and the types in `lib/queues.ts`,
 * `lib/loop-config.ts` and `lib/reporter-types.ts`), so the UI components
 * that consume them render exactly as they would against a live repo.
 *
 * ## THE RULE: nothing real goes in this file
 *
 * Every idea, pull request, learning, config value and news item below is
 * INVENTED for a fictional product, "Aurora Notes" — a note-taking app run by
 * the same loop this dashboard operates for real, private projects. No text
 * here was copied from an actual issue, PR, commit, or config. No owner
 * handle appears beyond the `loop-demo` / `DEMO_OWNER` constant from
 * `lib/demo/world.ts`, which nobody owns. See that file's own header for why
 * a real snapshot was rejected in favor of this fiction. If you are adding to
 * this file: write it the way a product-savvy agent actually would (problem,
 * proposal, why now, how to verify) — that quality is the point of the demo —
 * but never paste in anything that came from a real repository.
 */

import type { DemoFixture } from "@/lib/demo/types";
import {
  DEMO_OWNER,
  DEMO_IDEA_NUMBERS,
  DEMO_PR_NUMBERS,
  DEMO_SHAS,
  DEMO_CAPTURED_AT,
  demoTime,
  demoRepoUrl,
} from "@/lib/demo/world";
import type {
  IdeasPayload,
  IdeaSummary,
  ThreadComment,
  BuildsPayload,
  PRSummary,
  PRDetail,
} from "@/lib/queues";
import { loopConfigFingerprint, type LoopConfig } from "@/lib/loop-config";
import type { LearningsPayload, RetroCommit } from "@/app/api/learnings/route";
import type { ServedDigest } from "@/lib/reporter";
import type { DigestItem, SourceStatus } from "@/lib/reporter-types";

/* ------------------------------------------------------------------ */
/* Shared narrative bits                                               */
/* ------------------------------------------------------------------ */

/** Every automated comment (Scout/Builder/Auditor/Demo agent) posts as this. */
const AGENT = "claude[bot]";
/** The human running the loop — the same handle `demoRepoUrl` links against. */
const OWNER = DEMO_OWNER;

/** Days-before-snapshot, built on top of `demoTime` so nothing here is a raw date. */
function daysAgo(days: number, extraHours = 0): string {
  return demoTime(days * 24 * 60 + extraHours * 60);
}

/** Hours-before-snapshot, for the Reporter's much tighter timeline. */
function hoursAgo(hours: number): string {
  return demoTime(hours * 60);
}

/* ------------------------------------------------------------------ */
/* Ideas                                                               */
/* ------------------------------------------------------------------ */

const IDEAS: Record<number, IdeaSummary> = {
  [DEMO_IDEA_NUMBERS.sharedNotebooks]: {
    number: DEMO_IDEA_NUMBERS.sharedNotebooks,
    title: "Share a notebook read-only with a link, no account required",
    body: `**Problem:** The only way to show someone a notebook today is to export it or take screenshots. Three separate people asked for a plain "send someone a link" option this week, and none of them wanted the recipient to need an Aurora Notes account just to look.

**Proposal:** Add a "Share read-only" action that mints a signed, revocable link (\`/n/:token\`) rendering the notebook in a stripped-down reader view — no edit controls, no account prompt. The link can be revoked from the notebook's settings at any time, and unrevoked links expire automatically after 30 days unless renewed.

**Why now:** This is one of the few real gaps stopping Aurora Notes from being used for lightweight collaboration, and it shows up again and again in the "why did you stop using this" exit survey.

**How we'd verify:** An integration test that mints a link, hits it from a logged-out session, confirms the content renders and that no mutation endpoint is reachable through it, then revokes the link and confirms the same URL 404s afterward.`,
    htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.sharedNotebooks}`),
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3),
    commentCount: 0,
    labels: ["proposal"],
    author: AGENT,
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  [DEMO_IDEA_NUMBERS.offlineQueue]: {
    number: DEMO_IDEA_NUMBERS.offlineQueue,
    title: "Queue note edits made offline and sync them when connectivity returns",
    body: `**Problem:** Aurora Notes assumes a live connection. Edit a note in a subway tunnel or on flaky conference Wi-Fi and the save either fails silently or throws a generic "couldn't save" toast — the two outcomes on record are lost text and confusion about whether anything actually saved.

**Proposal:** Buffer writes locally the moment \`save()\` fails on a network error, tag each one with a client-generated op id and vector clock, and replay the queue in order the next time \`navigator.onLine\` flips true. Add a small "N changes pending sync" pill to the toolbar so the state is never invisible.

**Why now:** Support threads tagged \`offline\` are the fastest-growing label this quarter, and the mobile web wrapper shipped last month made it worse — mobile networks drop far more than desktop Wi-Fi ever did.

**How we'd verify:** A Playwright test that forces the page offline mid-edit, keeps typing, restores the network, and asserts the note round-trips with no missing characters and no duplicate note created.`,
    htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.offlineQueue}`),
    createdAt: daysAgo(6),
    updatedAt: daysAgo(5),
    commentCount: 1,
    labels: ["approved"],
    author: AGENT,
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  [DEMO_IDEA_NUMBERS.exportMarkdown]: {
    number: DEMO_IDEA_NUMBERS.exportMarkdown,
    title: "Bulk export a notebook to a folder of Markdown files",
    body: `**Problem:** Aurora Notes has no export path beyond copy-pasting one note at a time. Anyone who wants to back up, migrate, or just leave the product is stuck doing that by hand.

**Proposal:** Add "Export notebook", which zips every note in a notebook as individual \`.md\` files, preserves folder structure with path-safe slugs, and rewrites internal note links into relative Markdown links so the export is actually usable elsewhere.

**Why now:** Data portability keeps coming up in the "why wouldn't you recommend this" survey question, and it's table stakes for a note-taking tool at this point — its absence reads as a red flag on its own.

**How we'd verify:** A script that exports a fixture notebook with nested folders and cross-links, unzips the result, and diffs the rendered Markdown against a golden snapshot.`,
    htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.exportMarkdown}`),
    createdAt: daysAgo(15),
    updatedAt: daysAgo(3),
    commentCount: 1,
    labels: ["redraft"],
    author: AGENT,
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  [DEMO_IDEA_NUMBERS.searchRanking]: {
    number: DEMO_IDEA_NUMBERS.searchRanking,
    title: "Search results ignore recency — old notes outrank ones edited today",
    body: `**Problem:** Search is pure text-match relevance with no recency weighting, so a three-month-old note that happens to repeat the query twice outranks a note edited an hour ago that matches once. "I know I just wrote this, why can't I find it" is the single most-repeated complaint in the last two months of support threads.

**Proposal:** Blend the existing text-match score with a recency decay term (roughly a 14-day half-life on \`updatedAt\`), re-rank the top 50 candidates, and keep the decay constant tunable so it's cheap to retune later without another release.

**Why now:** It's the most-repeated piece of negative feedback we have, and it's a scoring change, not a schema migration — low risk, high visibility.

**How we'd verify:** A ranking eval against a hand-labeled set of 40 (query, expected top result) pairs, comparing top-1 and top-3 accuracy before and after the recency term lands.`,
    htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.searchRanking}`),
    createdAt: daysAgo(26),
    updatedAt: daysAgo(21),
    commentCount: 2,
    labels: ["approved"],
    author: AGENT,
    authorAvatar: "",
    state: "closed",
    closedAt: daysAgo(21),
    stateReason: "completed",
  },
  [DEMO_IDEA_NUMBERS.duplicateDetection]: {
    number: DEMO_IDEA_NUMBERS.duplicateDetection,
    title: 'Detect duplicate notes created by double-tapping "New note"',
    body: `**Problem:** Double-tapping "New note" on a slow connection creates two identical empty notes. It's rare, but when it happens the notebook sidebar fills with junk that only manual cleanup fixes.

**Proposal:** Debounce the "New note" action for 800ms client-side, and add a server-side idempotency key on the create-note endpoint so a retried request can't produce a second note.

**Why now:** Filed after two separate bug reports in the same week.

**How we'd verify:** A test that fires two rapid \`createNote\` calls with the same idempotency key and asserts exactly one note exists afterward.`,
    htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.duplicateDetection}`),
    createdAt: daysAgo(35),
    updatedAt: daysAgo(29),
    commentCount: 1,
    labels: ["declined"],
    author: AGENT,
    authorAvatar: "",
    state: "closed",
    closedAt: daysAgo(29),
    stateReason: "not_planned",
  },
};

const IDEA_COMMENTS: Record<number, ThreadComment[]> = {
  [DEMO_IDEA_NUMBERS.offlineQueue]: [
    {
      id: 401001,
      author: OWNER,
      authorAvatar: "",
      body: "Approved — this pairs well with the mobile wrapper work, good timing.",
      createdAt: daysAgo(5),
      htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.offlineQueue}#issuecomment-401001`),
      isBot: false,
    },
  ],
  [DEMO_IDEA_NUMBERS.exportMarkdown]: [
    {
      id: 401002,
      author: OWNER,
      authorAvatar: "",
      body: "**Owner feedback for redraft:**\n\nScope this to one notebook at a time for v1 — zipping the whole account in a single request risks timing out. Keep the link-rewriting part exactly as proposed, that's the right call.",
      createdAt: daysAgo(3),
      htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.exportMarkdown}#issuecomment-401002`),
      isBot: false,
    },
  ],
  [DEMO_IDEA_NUMBERS.searchRanking]: [
    {
      id: 401003,
      author: OWNER,
      authorAvatar: "",
      body: "Approved — this is the most-requested fix we have, let's get it in front of the Builder.",
      createdAt: daysAgo(24),
      htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.searchRanking}#issuecomment-401003`),
      isBot: false,
    },
    {
      id: 401004,
      author: AGENT,
      authorAvatar: "",
      body: `This shipped in #${DEMO_PR_NUMBERS.searchRanking}.`,
      createdAt: daysAgo(21),
      htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.searchRanking}#issuecomment-401004`),
      isBot: true,
    },
  ],
  [DEMO_IDEA_NUMBERS.duplicateDetection]: [
    {
      id: 401005,
      author: OWNER,
      authorAvatar: "",
      body: "**Declined by the owner:**\n\nThe debounce alone covers the double-tap case; the idempotency key needs a data-model change we're not taking on this quarter. Revisit if this keeps recurring.",
      createdAt: daysAgo(29),
      htmlUrl: demoRepoUrl(`issues/${DEMO_IDEA_NUMBERS.duplicateDetection}#issuecomment-401005`),
      isBot: false,
    },
  ],
};

const IDEAS_PAYLOAD: IdeasPayload = {
  waiting: [IDEAS[DEMO_IDEA_NUMBERS.sharedNotebooks]!],
  approved: [IDEAS[DEMO_IDEA_NUMBERS.offlineQueue]!],
  redraft: [IDEAS[DEMO_IDEA_NUMBERS.exportMarkdown]!],
  // Newest-closed first, matching loadIdeas' `byClosed` sort.
  closed: [
    IDEAS[DEMO_IDEA_NUMBERS.searchRanking]!,
    IDEAS[DEMO_IDEA_NUMBERS.duplicateDetection]!,
  ],
};

/* ------------------------------------------------------------------ */
/* Builds / pull requests                                              */
/* ------------------------------------------------------------------ */

const PR_DETAILS: Record<number, PRDetail> = {
  [DEMO_PR_NUMBERS.attachmentLimits]: {
    number: DEMO_PR_NUMBERS.attachmentLimits,
    title: "Raise the attachment size limit and give clearer upload errors",
    headRef: "claude/attachment-limits",
    baseRef: "main",
    htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.attachmentLimits}`),
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(6),
    mergedAt: null,
    closedAt: null,
    state: "open",
    merged: false,
    author: AGENT,
    authorAvatar: "",
    draft: true,
    body: "Bumps the per-attachment cap from 10MB to 25MB and swaps the generic \"upload failed\" toast for a message that says whether the file was rejected for size, type, or a network error. Still wiring up the client-side pre-check so oversized files never start uploading in the first place — marking as draft until that lands.",
    additions: 74,
    deletions: 21,
    changedFiles: 4,
    mergeable: null,
    mergeableState: "unknown",
    behindBy: 0,
    verdict: null,
    demo: { status: "none" },
    comments: [],
  },
  [DEMO_PR_NUMBERS.offlineQueue]: {
    number: DEMO_PR_NUMBERS.offlineQueue,
    title: "Add offline write queue with buffered saves and sync-on-reconnect",
    headRef: `claude/offline-queue-${DEMO_IDEA_NUMBERS.offlineQueue}`,
    baseRef: "main",
    htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.offlineQueue}`),
    createdAt: daysAgo(4),
    updatedAt: daysAgo(1),
    mergedAt: null,
    closedAt: null,
    state: "open",
    merged: false,
    author: AGENT,
    authorAvatar: "",
    draft: false,
    body: `Closes #${DEMO_IDEA_NUMBERS.offlineQueue}.\n\nBuffers failed saves locally, tagged with an op id and vector clock, and replays them in order once \`navigator.onLine\` flips true. Adds a "N changes pending sync" pill to the toolbar.\n\n- New offline-queue module with the buffer + replay logic\n- Toolbar pending-sync pill\n- Playwright test that forces a network drop mid-edit`,
    additions: 312,
    deletions: 18,
    changedFiles: 9,
    mergeable: true,
    mergeableState: "clean",
    behindBy: 2,
    verdict: {
      verdict: "SHIP",
      body: `## 🔍 Adversarial audit — PR #${DEMO_PR_NUMBERS.offlineQueue}\n\nWalked the replay logic through a forced-offline Playwright run, including an interrupted refresh mid-queue. Op order is preserved, no duplicate notes appear, and the pending-sync pill clears once the queue drains.\n\n**Verdict:** ✅ **SHIP**\n\nNon-blocking: the vector-clock comparison allocates a fresh array per op — fine at today's scale, worth revisiting if queues ever get long.`,
      htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.offlineQueue}#issuecomment-402001`),
      author: AGENT,
      createdAt: daysAgo(1),
    },
    demo: {
      status: "comment-only",
      commentBody:
        "📸 **Demo evidence**\n\nTyped into a note, forced the tab offline, kept typing, restored the connection, and watched the pending-sync pill count down to zero with the note intact end to end.",
      commentUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.offlineQueue}#issuecomment-402002`),
    },
    comments: [
      {
        id: 402001,
        author: AGENT,
        authorAvatar: "",
        body: `## 🔍 Adversarial audit — PR #${DEMO_PR_NUMBERS.offlineQueue}\n\nWalked the replay logic through a forced-offline Playwright run, including an interrupted refresh mid-queue. Op order is preserved, no duplicate notes appear, and the pending-sync pill clears once the queue drains.\n\n**Verdict:** ✅ **SHIP**\n\nNon-blocking: the vector-clock comparison allocates a fresh array per op — fine at today's scale, worth revisiting if queues ever get long.`,
        createdAt: daysAgo(1),
        htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.offlineQueue}#issuecomment-402001`),
        isBot: true,
      },
      {
        id: 402002,
        author: AGENT,
        authorAvatar: "",
        body: "📸 **Demo evidence**\n\nTyped into a note, forced the tab offline, kept typing, restored the connection, and watched the pending-sync pill count down to zero with the note intact end to end.",
        createdAt: daysAgo(1),
        htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.offlineQueue}#issuecomment-402002`),
        isBot: true,
      },
    ],
  },
  [DEMO_PR_NUMBERS.searchRanking]: {
    number: DEMO_PR_NUMBERS.searchRanking,
    title: "Blend recency into search ranking",
    headRef: `claude/search-ranking-${DEMO_IDEA_NUMBERS.searchRanking}`,
    baseRef: "main",
    htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.searchRanking}`),
    createdAt: daysAgo(23),
    updatedAt: daysAgo(21),
    mergedAt: daysAgo(21),
    closedAt: daysAgo(21),
    state: "closed",
    merged: true,
    author: AGENT,
    authorAvatar: "",
    draft: false,
    body: `Closes #${DEMO_IDEA_NUMBERS.searchRanking}.\n\nAdds a recency decay term (14-day half-life on \`updatedAt\`) to the existing text-match score and re-ranks the top 50 candidates before returning results.\n\nEval: top-1 accuracy on the 40-pair hand-labeled set went from 61% to 88%; top-3 from 79% to 97%.`,
    additions: 96,
    deletions: 14,
    changedFiles: 3,
    mergeable: true,
    mergeableState: "clean",
    behindBy: 0,
    verdict: {
      verdict: "SHIP",
      body: `## 🔍 Adversarial audit — PR #${DEMO_PR_NUMBERS.searchRanking}\n\nRan the eval script against the 40-pair set myself; the numbers in the PR description hold up. Tried a handful of adversarial queries against old-but-frequently-matching notes and the decay term behaves — nothing regresses below the pre-change baseline.\n\n**Verdict:** ✅ **SHIP**`,
      htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.searchRanking}#issuecomment-402003`),
      author: AGENT,
      createdAt: daysAgo(21, 2),
    },
    demo: {
      status: "comment-only",
      commentBody:
        "📸 **Demo evidence**\n\nSearched a term that matched both an old note and a just-edited note; the just-edited one now shows first. Before/after screenshots are attached to the linked run.",
      commentUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.searchRanking}#issuecomment-402004`),
    },
    comments: [
      {
        id: 402003,
        author: AGENT,
        authorAvatar: "",
        body: `## 🔍 Adversarial audit — PR #${DEMO_PR_NUMBERS.searchRanking}\n\nRan the eval script against the 40-pair set myself; the numbers in the PR description hold up. Tried a handful of adversarial queries against old-but-frequently-matching notes and the decay term behaves — nothing regresses below the pre-change baseline.\n\n**Verdict:** ✅ **SHIP**`,
        createdAt: daysAgo(21, 2),
        htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.searchRanking}#issuecomment-402003`),
        isBot: true,
      },
      {
        id: 402004,
        author: AGENT,
        authorAvatar: "",
        body: "📸 **Demo evidence**\n\nSearched a term that matched both an old note and a just-edited note; the just-edited one now shows first. Before/after screenshots are attached to the linked run.",
        createdAt: daysAgo(21, 1),
        htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.searchRanking}#issuecomment-402004`),
        isBot: true,
      },
    ],
  },
  [DEMO_PR_NUMBERS.staleSessions]: {
    number: DEMO_PR_NUMBERS.staleSessions,
    title: "Auto-expire sessions after 30 days idle",
    headRef: "claude/stale-sessions",
    baseRef: "main",
    htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.staleSessions}`),
    createdAt: daysAgo(10),
    updatedAt: daysAgo(8),
    mergedAt: null,
    closedAt: daysAgo(8),
    state: "closed",
    merged: false,
    author: AGENT,
    authorAvatar: "",
    draft: false,
    body: "Adds a background job that revokes any session with no activity for 30 days straight. First pass deletes the session row directly once it's flagged idle.",
    additions: 41,
    deletions: 6,
    changedFiles: 2,
    mergeable: true,
    mergeableState: "clean",
    behindBy: 0,
    verdict: {
      verdict: "FIX FIRST",
      body: `## 🔍 Adversarial audit — PR #${DEMO_PR_NUMBERS.staleSessions}\n\nThe idle check reads \`last_seen_at\` off the session row, but nothing updates that column on a read-only request — only on writes. In practice, a session sitting on a notes-reading tab would look idle within a day and get logged out mid-use.\n\n**Verdict:** FIX FIRST\n\nBump \`last_seen_at\` on any authenticated request, not just writes, before this is safe to ship.`,
      htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.staleSessions}#issuecomment-402005`),
      author: AGENT,
      createdAt: daysAgo(9),
    },
    demo: { status: "none" },
    comments: [
      {
        id: 402005,
        author: AGENT,
        authorAvatar: "",
        body: `## 🔍 Adversarial audit — PR #${DEMO_PR_NUMBERS.staleSessions}\n\nThe idle check reads \`last_seen_at\` off the session row, but nothing updates that column on a read-only request — only on writes. In practice, a session sitting on a notes-reading tab would look idle within a day and get logged out mid-use.\n\n**Verdict:** FIX FIRST\n\nBump \`last_seen_at\` on any authenticated request, not just writes, before this is safe to ship.`,
        createdAt: daysAgo(9),
        htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.staleSessions}#issuecomment-402005`),
        isBot: true,
      },
      {
        id: 402006,
        author: OWNER,
        authorAvatar: "",
        body: "Closing for now — the activity-tracking piece needs to be its own change first. Reopen once that's in.",
        createdAt: daysAgo(8),
        htmlUrl: demoRepoUrl(`pull/${DEMO_PR_NUMBERS.staleSessions}#issuecomment-402006`),
        isBot: false,
      },
    ],
  },
};

/** `PRDetail` narrowed to the row shape `/api/builds` actually returns. */
function toSummary(detail: PRDetail): PRSummary {
  const {
    number,
    title,
    headRef,
    htmlUrl,
    createdAt,
    updatedAt,
    mergedAt,
    closedAt,
    state,
    merged,
    author,
    authorAvatar,
    draft,
  } = detail;
  return {
    number,
    title,
    headRef,
    htmlUrl,
    createdAt,
    updatedAt,
    mergedAt,
    closedAt,
    state,
    merged,
    author,
    authorAvatar,
    draft,
  };
}

// Sorted newest-created-first within each tab, matching loadBuilds().
const NEEDS_REVIEW: PRSummary[] = [
  toSummary(PR_DETAILS[DEMO_PR_NUMBERS.attachmentLimits]!),
  toSummary(PR_DETAILS[DEMO_PR_NUMBERS.offlineQueue]!),
];

const BUILDS_PAYLOAD: BuildsPayload = {
  needsReview: NEEDS_REVIEW,
  merged: [toSummary(PR_DETAILS[DEMO_PR_NUMBERS.searchRanking]!)],
  closed: [toSummary(PR_DETAILS[DEMO_PR_NUMBERS.staleSessions]!)],
  // Drafts (attachmentLimits) don't count toward the Builder's own cap.
  capCount: NEEDS_REVIEW.filter((pr) => !pr.draft).length,
};

/* ------------------------------------------------------------------ */
/* Learnings                                                           */
/* ------------------------------------------------------------------ */

const LEARNINGS_MARKDOWN = `# LEARNINGS.md

Notes the loop has left itself after builds on Aurora Notes. Kept short —
each entry is one lesson, not a changelog.

## Offline queue replay must be idempotent, not just ordered

PR #${DEMO_PR_NUMBERS.offlineQueue} originally replayed the buffered-save
queue by op id order alone. The Auditor's forced-offline test caught a case
where a page refresh mid-replay re-sent an op that had already landed —
ordering was correct, but nothing stopped the same op from applying twice.
Fix: every replayed op now carries an idempotency key the server dedupes on,
not just a position in the queue.

## Recency decay needs a floor, or very old notes vanish from search entirely

The first pass at PR #${DEMO_PR_NUMBERS.searchRanking}'s ranking change let
the decay term go all the way to zero for anything older than ~60 days,
which meant a genuinely correct old match could drop off the results page
completely rather than just rank lower. Retro: decay curves need an explicit
floor so "older" degrades relevance, it doesn't erase it.

## "Idle" needs an activity signal that updates on reads, not just writes

PR #${DEMO_PR_NUMBERS.staleSessions} defined session idleness against
\`last_seen_at\`, but nothing touched that column on a plain read request.
The Auditor flagged it before merge: a session sitting open on a notes page
would have looked idle and been logged out mid-use. Lesson carried forward
to every future "expire after N days inactive" idea — the activity signal
has to include reads.
`;

const LEARNINGS_RETROS: RetroCommit[] = [
  {
    sha: DEMO_SHAS.auditorRubric,
    shortSha: DEMO_SHAS.auditorRubric.slice(0, 7),
    message: "retro: idle-session checks must count reads, not just writes",
    author: AGENT,
    date: daysAgo(8),
    url: demoRepoUrl(`commit/${DEMO_SHAS.auditorRubric}`),
  },
  {
    sha: DEMO_SHAS.builderRetry,
    shortSha: DEMO_SHAS.builderRetry.slice(0, 7),
    message: "retro: recency decay needs a floor so old notes stay findable",
    author: AGENT,
    date: daysAgo(21, 2),
    url: demoRepoUrl(`commit/${DEMO_SHAS.builderRetry}`),
  },
  {
    sha: DEMO_SHAS.scoutTuning,
    shortSha: DEMO_SHAS.scoutTuning.slice(0, 7),
    message: "retro: offline replay must dedupe by idempotency key, not order alone",
    author: AGENT,
    date: daysAgo(1),
    url: demoRepoUrl(`commit/${DEMO_SHAS.scoutTuning}`),
  },
];

const LEARNINGS_PAYLOAD: LearningsPayload = {
  markdown: LEARNINGS_MARKDOWN,
  lineCount: LEARNINGS_MARKDOWN.split("\n").length,
  retros: LEARNINGS_RETROS,
};

/* ------------------------------------------------------------------ */
/* Loop config                                                         */
/* ------------------------------------------------------------------ */

const LOOP_CONFIG: LoopConfig = {
  autonomousBuildEnabled: false,
  prCap: 4,
  ideaQueueCap: 15,
  scout: {
    productSummary:
      "Aurora Notes is a fast, offline-friendly note-taking app for people who think in notebooks, not folders. Core loop: write a note, organize it into a notebook, find it again instantly.",
    currentGoals: [
      "Make offline editing reliable end-to-end",
      "Close the biggest search-quality gaps",
      "Add lightweight sharing without requiring an account",
    ],
    offLimits: [
      "Billing and subscription flows",
      "The encryption-at-rest layer",
    ],
    lenses: [
      "What's the fastest way for someone to lose data right now?",
      "What's the top recurring complaint in support threads this month?",
      "What would make Aurora Notes usable on a flight?",
    ],
    maxPerRun: 3,
  },
};

/* ------------------------------------------------------------------ */
/* Reporter digest                                                     */
/* ------------------------------------------------------------------ */

const DIGEST_ITEMS: DigestItem[] = [
  {
    id: "code-release-2026-09-01",
    source: "Claude Code releases",
    sourceKey: "releases",
    title: "Claude Code adds resumable background agent sessions",
    url: "https://docs.anthropic.com/en/release-notes/claude-code",
    date: hoursAgo(20),
    category: "code-release",
    summary:
      "A background agent run can now be detached and reattached from a different terminal without losing its state — useful for long builder or auditor runs kicked off from CI.",
    sortTs: Date.parse(hoursAgo(20)),
    pinned: true,
  },
  {
    id: "news-2026-08-31-tool-safety",
    source: "Anthropic News",
    sourceKey: "anthropic-news",
    title: "Anthropic publishes updated guidance on agentic tool-use safety",
    url: "https://www.anthropic.com/news",
    date: hoursAgo(30),
    category: "news",
    summary:
      "New guidance on scoping tool permissions and sandboxing for autonomous coding agents that act on a live repository without a human in the loop for every step.",
    sortTs: Date.parse(hoursAgo(30)),
  },
  {
    id: "technique-willison-overnight-loops",
    source: "Simon Willison",
    sourceKey: "willison",
    title: "Notes on running an agent loop unattended overnight",
    url: "https://simonwillison.net/",
    date: hoursAgo(40),
    category: "technique",
    summary:
      "A field report on the failure modes that only show up after hours of unattended agent runtime, and the guardrails that caught them before they reached production.",
    sortTs: Date.parse(hoursAgo(40)),
  },
  {
    id: "ai-news-alphasignal-benchmarks",
    source: "AlphaSignal",
    sourceKey: "alphasignal",
    title: "Agentic coding benchmarks: where the frontier models actually differ",
    url: "https://alphasignal.ai",
    date: hoursAgo(50),
    category: "ai-news",
    summary:
      "A roundup comparing long-horizon coding task completion rates across current frontier models, with the biggest gaps showing up past the first hour of a run.",
    sortTs: Date.parse(hoursAgo(50)),
  },
  {
    id: "mcp-postgres-introspection",
    source: "MCP Registry",
    sourceKey: "mcp-registry",
    title: "New MCP server adds structured Postgres schema introspection",
    url: "https://github.com/modelcontextprotocol",
    date: hoursAgo(60),
    category: "mcp",
    summary:
      "Lets an agent inspect table, column and constraint metadata directly through a typed tool call instead of shelling out to psql and parsing text output.",
    sortTs: Date.parse(hoursAgo(60)),
  },
  {
    id: "skill-plugin-changelog-automation",
    source: "Claude Code plugins",
    sourceKey: "plugins",
    title: "New skill drafts a changelog straight from merged PRs",
    url: "https://github.com/anthropics/claude-code",
    date: hoursAgo(70),
    category: "skill-plugin",
    summary:
      "Walks the merged-PR history since the last tag and drafts a changelog section grouped by conventional-commit type, ready for a human to trim before release.",
    sortTs: Date.parse(hoursAgo(70)),
  },
  {
    id: "community-hn-pr-auditor",
    source: "Hacker News",
    sourceKey: "hn",
    title: "Show HN: a self-hosted adversarial PR auditor agent",
    url: "https://news.ycombinator.com/",
    date: hoursAgo(80),
    category: "community",
    summary:
      "A small project that posts a SHIP / FIX FIRST verdict on every open PR before a human reviews it, built as a standalone GitHub Action.",
    sortTs: Date.parse(hoursAgo(80)),
    insight:
      "Top comment asks how it avoids rubber-stamping; the author's reply says it re-runs the test suite itself rather than trusting anything the PR description claims.",
    discussionUrl: "https://news.ycombinator.com/",
  },
  {
    id: "ai-news-arxiv-long-horizon-eval",
    source: "arXiv",
    sourceKey: "arxiv",
    title: "Evaluating long-horizon agentic coding tasks",
    url: "https://arxiv.org/abs/2502.16161",
    date: hoursAgo(95),
    category: "ai-news",
    summary:
      "Proposes a benchmark for multi-hour agentic coding sessions and finds completion rates drop sharply past the first hour without explicit checkpointing.",
    sortTs: Date.parse(hoursAgo(95)),
  },
];

const DIGEST_SOURCES: SourceStatus[] = [
  { key: "releases", label: "Claude Code releases", ok: true, count: 1 },
  { key: "anthropic-news", label: "Anthropic news", ok: true, count: 1 },
  { key: "willison", label: "Simon Willison", ok: true, count: 1 },
  { key: "alphasignal", label: "AlphaSignal", ok: true, count: 1 },
  { key: "mcp-registry", label: "MCP servers", ok: true, count: 1 },
  { key: "plugins", label: "Claude Code plugins", ok: true, count: 1 },
  { key: "hn", label: "Hacker News", ok: true, count: 1 },
  { key: "arxiv", label: "arXiv", ok: true, count: 1 },
];

const DIGEST: ServedDigest = {
  items: DIGEST_ITEMS,
  lastUpdated: DEMO_CAPTURED_AT,
  sources: DIGEST_SOURCES,
  partial: false,
};

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

/** Read the trailing `/:number` segment off a matched, anchored path. */
function trailingNumber(url: URL): number {
  const segment = url.pathname.split("/").pop() ?? "";
  return Number(segment);
}

export const QUEUE_FIXTURES: DemoFixture[] = [
  {
    match: "/api/ideas",
    methods: ["GET"],
    body: (): IdeasPayload => IDEAS_PAYLOAD,
  },
  {
    // Anchored so this never answers /api/ideas/[number]/chat or
    // /api/ideas/custom — and GET-only, so the POST action route on the same
    // path falls through to a 403 rather than being answered here.
    match: /^\/api\/ideas\/\d+$/,
    methods: ["GET"],
    body: (url): { comments: ThreadComment[] } => {
      const number = trailingNumber(url);
      // An idea number outside the demo set (nothing a visitor following the
      // UI would ever request) just gets an empty thread rather than a crash.
      return { comments: IDEA_COMMENTS[number] ?? [] };
    },
  },
  {
    match: "/api/builds",
    methods: ["GET"],
    body: (): BuildsPayload => BUILDS_PAYLOAD,
  },
  {
    match: /^\/api\/builds\/\d+$/,
    methods: ["GET"],
    body: (url): PRDetail => {
      const number = trailingNumber(url);
      return PR_DETAILS[number] ?? PR_DETAILS[DEMO_PR_NUMBERS.offlineQueue]!;
    },
  },
  {
    match: "/api/learnings",
    methods: ["GET"],
    body: (): LearningsPayload => LEARNINGS_PAYLOAD,
  },
  {
    // GET only — the PATCH that saves config must fall through to a 403, so
    // an anonymous visitor can look at automation settings but never change
    // them (there is no target repo behind this demo to write to anyway).
    match: "/api/loop-config",
    methods: ["GET"],
    body: (): { config: LoopConfig; fingerprint: string } => ({
      config: LOOP_CONFIG,
      fingerprint: loopConfigFingerprint(LOOP_CONFIG),
    }),
  },
  {
    match: "/api/reporter",
    methods: ["GET"],
    body: (): { digest: ServedDigest } => ({ digest: DIGEST }),
  },
];
