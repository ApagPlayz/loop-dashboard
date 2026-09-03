/**
 * The shared "world" every demo fixture is written against.
 *
 * ## Why this data is invented rather than real
 *
 * The obvious snapshot source was `data/corpus.jsonl` — 132 real issues and PRs
 * already committed to this repo. It was rejected: `ApagPlayz/loop-dashboard`
 * is PRIVATE (verified, not assumed), so nothing in it is public yet, and those
 * 132 documents are the full bodies of issues and PRs from the owner's private
 * projects. Serving them from a link handed to recruiters would be the first
 * public disclosure of that content, decided by an automated change rather than
 * by the owner. "Already in the repo" is not the same as "already published".
 *
 * `metrics/dedup-eval.json` was checked separately and is genuinely safe — it
 * holds only aggregate numbers and methodology notes, no document text — but
 * nothing in the UI reads it, so it is not what the dashboard would show.
 *
 * So the demo shows a fictional project run by the same loop. It leaks exactly
 * nothing, it stays honest as long as the banner says so, and it demonstrates
 * the product — which is the machinery, not the owner's backlog.
 *
 * ## Rules for editing this file
 *
 * - Never paste real issue/PR text, real private repo names, or real owner
 *   handles in here. `loop-demo` is not a real GitHub account.
 * - Keep dates frozen. A demo that says "3 minutes ago" and never changes looks
 *   broken; one that is openly a snapshot from a fixed date does not.
 * - Every id, number and key used by more than one fixture belongs here, so the
 *   panels tell one coherent story instead of contradicting each other.
 */

import type { Project } from "@/lib/projects";

/** The instant the whole snapshot is pinned to. Everything else hangs off it. */
export const DEMO_CAPTURED_AT = "2026-09-02T18:40:00.000Z";

/** Human-readable form used in "last updated" lines. */
export const DEMO_CAPTURED_LABEL = "2 September 2026";

/**
 * The banner string, kept HERE rather than in lib/public-access.ts because
 * components/app-shell.tsx is a Client Component: importing it from
 * public-access would drag lib/auth.ts — HMAC verification, the
 * DASHBOARD_PASSWORD lookup and its error text — into the browser bundle. No
 * secret would actually cross (Next only inlines NEXT_PUBLIC_* into client
 * code), but shipping the session-verification module to every visitor is not
 * something to do by accident. This file has no runtime imports at all.
 */
export const DEMO_SNAPSHOT_LABEL = `Demo snapshot · ${DEMO_CAPTURED_LABEL}`;

/**
 * `owner` is a handle nobody owns and `repo` names describe the fiction. If a
 * `GITHUB_TOKEN` is ever added to the deployment, calls scoped to these repos
 * 404 rather than reaching anything real — which is the second safety layer
 * described in lib/public-access.ts.
 */
export const DEMO_OWNER = "loop-demo";

export const DEMO_PROJECTS: Project[] = [
  {
    key: "aurora-notes",
    owner: DEMO_OWNER,
    repo: "aurora-notes",
    label: "Aurora Notes",
    addedAt: "2026-06-11T09:15:00.000Z",
  },
  {
    key: "tidepool-api",
    owner: DEMO_OWNER,
    repo: "tidepool-api",
    label: "Tidepool API",
    addedAt: "2026-07-28T14:02:00.000Z",
  },
];

export const DEMO_DEFAULT_PROJECT = DEMO_PROJECTS[0]!;

/** A stand-in URL for anything that would normally deep-link into GitHub. */
export function demoRepoUrl(path = ""): string {
  const base = `https://github.com/${DEMO_OWNER}/${DEMO_DEFAULT_PROJECT.repo}`;
  return path ? `${base}/${path.replace(/^\//, "")}` : base;
}

/** Fixed commit SHAs reused across the history, testing and drift fixtures. */
export const DEMO_SHAS = {
  scoutTuning: "9f2c41ab7d05e6c8b3149ae02fd7715c6b0a4e31",
  builderRetry: "3ad70c5e18b94f22a6d0c7318e5b41f9d2c60a77",
  auditorRubric: "c481be9027a35d16f7e0b48a91c25d3f60ea7b14",
} as const;

/** Issue numbers used by the ideas fixtures (and referenced from testing). */
export const DEMO_IDEA_NUMBERS = {
  offlineQueue: 214,
  sharedNotebooks: 211,
  exportMarkdown: 208,
  searchRanking: 203,
  duplicateDetection: 198,
} as const;

/** PR numbers used by the builds fixtures. */
export const DEMO_PR_NUMBERS = {
  offlineQueue: 216,
  attachmentLimits: 215,
  searchRanking: 209,
  staleSessions: 205,
} as const;

/** Workflow run ids reused by the testing fixtures. */
export const DEMO_RUN_IDS = {
  scout: 18422031,
  builder: 18421884,
  auditor: 18421902,
  demo: 18421655,
  tests: 18421410,
} as const;

/**
 * Offsets are expressed against DEMO_CAPTURED_AT so the story stays internally
 * consistent ("the Builder ran 40 minutes before this snapshot") no matter when
 * someone reads it.
 */
export function demoTime(minutesBefore: number): string {
  return new Date(Date.parse(DEMO_CAPTURED_AT) - minutesBefore * 60_000).toISOString();
}
