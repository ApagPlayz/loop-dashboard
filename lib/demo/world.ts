/**
 * The shared "world" every demo fixture is written against.
 *
 * ## What this data is
 *
 * A FROZEN SNAPSHOT OF THE OWNER'S REAL LOOP, captured with `gh` on
 * 4 September 2026 from two repositories that are now PUBLIC:
 *
 *   - github.com/ApagPlayz/content-generation-platform  (loop running)
 *   - github.com/ApagPlayz/supply-chain-optimizer       (loop paused on purpose)
 *
 * Every issue title, PR body, audit verdict, workflow file, learning and metric
 * below was copied from those repos, not written for the demo. An earlier
 * version of this file explained at length why the demo used an invented
 * project instead ("Aurora Notes", under a fictional `loop-demo` owner). That
 * reasoning is gone: it rested on the repos being private, so that publishing
 * their issue text would have been a first disclosure decided by an automated
 * change rather than by the owner. Both repos are public now, and the owner
 * asked for the real thing.
 *
 * ## Why it is still a frozen snapshot rather than a live feed
 *
 * The public deployment deliberately holds NO `GITHUB_TOKEN` (see
 * infra/deploy.sh — the owner's token is over-scoped and must never reach the
 * cloud). So the demo cannot fetch anything at request time even though the
 * repos it describes are readable by anyone. The snapshot is baked in here, and
 * the banner in components/app-shell.tsx says so with this file's capture date.
 *
 * ## Rules for editing this file
 *
 * - Real content only. Copy it, don't paraphrase it, and don't fill gaps with
 *   invention — an item that reads badly gets LEFT OUT, not rewritten.
 * - Before baking anything in, grep it for `gho_`, `ghp_`, `github_pat_`,
 *   `sk-ant-`, `AKIA`, `/Users/` and email addresses. None of those may ship.
 * - Keep dates frozen and absolute. A snapshot that says "3 minutes ago" and
 *   never changes looks broken; a dated one does not.
 * - Every id, number and key used by more than one fixture belongs here, so the
 *   panels tell one coherent story instead of contradicting each other.
 *
 * ## One security note
 *
 * `lib/projects.ts` hands these two projects to anonymous viewers, so any
 * repo-scoped call a server component makes points HERE. That used to point at
 * a repo nobody owned. It now points at two real, public repos — which is still
 * safe (no token is deployed, and every anonymous `/api/*` read is answered
 * from a fixture without the handler running), but it is a weaker second layer
 * than "the repo does not exist". Layer one — the proxy in lib/public-access.ts
 * refusing anything without a fixture — is the one that matters.
 */

import type { Project } from "@/lib/projects";

/** The instant the whole snapshot is pinned to. Everything else hangs off it. */
export const DEMO_CAPTURED_AT = "2026-09-04T19:40:00.000Z";

/** Human-readable form used in "last updated" lines. */
export const DEMO_CAPTURED_LABEL = "4 September 2026";

/**
 * The banner string, kept HERE rather than in lib/public-access.ts because
 * components/app-shell.tsx is a Client Component: importing it from
 * public-access would drag lib/auth.ts — HMAC verification, the
 * DASHBOARD_PASSWORD lookup and its error text — into the browser bundle. No
 * secret would actually cross (Next only inlines NEXT_PUBLIC_* into client
 * code), but shipping the session-verification module to every visitor is not
 * something to do by accident. This file has no runtime imports at all.
 */
export const DEMO_SNAPSHOT_LABEL = `Frozen snapshot · captured ${DEMO_CAPTURED_LABEL}`;

/** The owner's real GitHub handle — both demo repos are public under it. */
export const DEMO_OWNER = "ApagPlayz";

/**
 * The two real projects the loop runs on, in the order the dashboard lists
 * them. `addedAt` is the commit date of each repo's first agent workflow —
 * the day the loop was actually installed there.
 */
export const DEMO_PROJECTS: Project[] = [
  {
    key: "content-generation-platform",
    owner: DEMO_OWNER,
    repo: "content-generation-platform",
    label: "Content Generation Platform",
    addedAt: "2026-07-13T15:53:08.000Z",
  },
  {
    key: "supply-chain-optimizer",
    owner: DEMO_OWNER,
    repo: "supply-chain-optimizer",
    label: "Supply Chain Optimizer",
    addedAt: "2026-07-14T15:00:56.000Z",
  },
];

export const DEMO_DEFAULT_PROJECT = DEMO_PROJECTS[0]!;

/** Deep-links into the default demo repo. These now resolve for real. */
export function demoRepoUrl(path = ""): string {
  const base = `https://github.com/${DEMO_OWNER}/${DEMO_DEFAULT_PROJECT.repo}`;
  return path ? `${base}/${path.replace(/^\//, "")}` : base;
}

/**
 * Real commit SHAs on content-generation-platform. Every one of these resolves
 * on GitHub; the message beside it is the real first line of that commit.
 */
export const DEMO_SHAS = {
  /** "Loop: roll out audited workflow updates from the dashboard template" */
  templateRollout: "37e236432e626ae7b919043ee41459fe7b0eac9d",
  /** "Loop: Scout dedups against open PRs + approved ideas (pull-requests: read)" */
  scoutDedupe: "ae799942b906126975fa51af80e6bfc87295f743",
  /** "Loop: Builder claim-detection matches issue# in PR title + branch, not just body" */
  builderClaim: "e02f1130fdd83b77620a3171ec993e35503a0307",
  /** "loop-config: re-trigger Auditor/Demo/Tests after an @mention pushes a follow-up fix…" */
  auditorRetrigger: "211a9201fbb07a4bf4fee46ff37de50068bffc4c",
  /** "loop-config: replace hardcoded overnight cap-lift…" (Scout side) */
  loopConfigScout: "a5125580f8679805b50b7d06fc453e9cb2a3a939",
  /** "Let the Auditor review the Builder's PRs (allowed_bots) (#24)" */
  auditorAllowBots: "59c22f91ec6e5b26f111a6b1238093854751366a",
  /** "Agents were ending their turn while their subagents were still running (#13)" */
  subagentTurn: "b7c27d4cbb3fe0c2650d349fc25efaccbaadcf24",
  /** "Make the loop actually run — fix the silent no-op, then run it continuously (#11)" */
  loopRunsContinuously: "56cf76af097c3e02148169bdbdb1dc071d6faaea",
  /** "Fix: allow agents to actually use gh/git (loop was silently no-op) (#10)" */
  allowedTools: "559657f5a3013ebb9f5052cd0cc63257b058e291",
  /** "Autonomous improvement loop v2: audit, measure, and learn (#8)" */
  loopV2: "6e9b6bde3e5bedd95ac8298261e3fb44e0840d6d",
  /** "[retro] Record the 07-17 lesson; prune LEARNINGS under its 50-line limit (#64)" */
  retroPruneLearnings: "d0af30353fb433bfdf46cb5dfc1f64c7182f046b",
  /** "Builder: start on approval, never build the same issue twice, read the comments (#33)" */
  builderOnApproval: "0443cd32c0da3398e9559b48015cbbf2707e04b4",
} as const;

/** Real issue numbers on content-generation-platform, used by the ideas fixtures. */
export const DEMO_IDEA_NUMBERS = {
  // Waiting (label `proposal`)
  watchedWinners: 118,
  tiktokSilentFail: 114,
  crashRecovery: 110,
  sportsStallTimeout: 102,
  aiSlopCheck: 86,
  // …and the one the near-duplicate strip fires on. #79 is a genuine
  // restatement of #27, filed by the Scout six days later because nothing
  // made it re-read its own queue. The dedup index scores the pair at 0.8616,
  // above the 0.842 operating point swept in metrics/dedup-eval.json.
  affiliateLinks: 79,
  // Approved (label `approved`)
  warmCreator: 126,
  promptCaching: 90,
  drawtextEscaping: 82,
  ctaLinks: 27,
  // Closed
  sportsHang: 96,
  narrationCut: 94,
  legalSafety: 45,
  budgetCap: 26,
  copyrightStrikes: 21,
} as const;

/** Real PR numbers on content-generation-platform, used by the builds fixtures. */
export const DEMO_PR_NUMBERS = {
  // Open, waiting on the owner
  warmCreatorV2: 131,
  drawtextEscaping: 125,
  pronunciation: 123,
  videoPreview: 119,
  facebookReels: 117,
  // Merged
  defamationFix: 122,
  budgetCap: 111,
  sportsStallTimeout: 99,
  narrationCut: 95,
  // Closed without merging — the first attempt at the same idea (#45)
  defamationFirstPass: 47,
} as const;

/** Real GitHub Actions run ids on content-generation-platform. */
export const DEMO_RUN_IDS = {
  scout: 33900734875,
  builder: 33899958637,
  auditor: 32868858539,
  demo: 32868858545,
  retro: 33343636364,
  metrics: 33885201689,
  tests: 32868858549,
  redraft: 32864760736,
  mention: 33344097672,
  toolinstall: 29616269119,
} as const;

/**
 * Offsets are expressed against DEMO_CAPTURED_AT for the handful of places
 * that genuinely need a relative time ("six hours before this snapshot").
 * Anything with a real timestamp uses the real timestamp instead.
 */
export function demoTime(minutesBefore: number): string {
  return new Date(Date.parse(DEMO_CAPTURED_AT) - minutesBefore * 60_000).toISOString();
}
