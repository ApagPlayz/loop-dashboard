/**
 * Demo payloads for server-rendered PAGES (as opposed to `/api/*` routes).
 *
 * Why this file exists separately from `lib/demo/api-fixtures.ts`: a page's
 * Server Component calls `lib/` functions directly — `loadOverview()`,
 * `getFileContent()`, `loadCapabilityInventory()` — instead of fetching its
 * own `/api/*` route, so it never passes through the proxy's anonymous-GET
 * interception. Each of those calls would otherwise try to read GitHub with a
 * token the public deployment does not have. This file holds what those pages
 * render instead, once they've established (via `isPublicViewer()`) that the
 * visitor is anonymous.
 *
 * Everything below is REAL, captured 4 September 2026 (see lib/demo/world.ts):
 * the overview counts are the two repos' actual open queues, the metrics
 * history is content-generation-platform's committed
 * `metrics/loop-metrics.json` in full, the write-up is its committed
 * `LOOP-DASHBOARD.md`, and the capability cards are parsed from the verbatim
 * workflow YAML in `lib/demo/fixtures-workflows.ts` — so the tools each agent
 * is granted are the tools it is really granted.
 */

import type { ProjectSnapshot } from "@/lib/overview";
import {
  computeSharedCapabilities,
  type AgentCapabilities,
  type SharedCapabilities,
} from "@/lib/tools";
import type { Snapshot as MetricsSnapshot } from "@/app/(app)/metrics/page";
import { DEMO_PROJECTS } from "@/lib/demo/world";

/* ------------------------------------------------------------------ */
/* Overview ("/")                                                      */
/* ------------------------------------------------------------------ */

const [CONTENT_PLATFORM, SUPPLY_CHAIN] = DEMO_PROJECTS;

/**
 * The two projects' real headline numbers, computed the way
 * `loadProjectSnapshot` computes them: `openIdeas` is every open issue
 * carrying a queue label (34 = 23 `proposal` + 11 `approved`), `openPRs`
 * counts open pull requests on `claude/` branches, and `agents` is the nine
 * loop workflows found in `.github/workflows/`.
 *
 * The two look different because they ARE different. The content platform's
 * loop is running and has thirteen pull requests waiting on the owner, so it
 * classifies as "building". The supply-chain optimizer's loop was switched off
 * on purpose while the owner repairs it — no open ideas, no open agent PRs,
 * and `classify()` therefore returns "idle". Showing that honestly is more
 * useful than two identical green cards.
 */
export const DEMO_OVERVIEW: ProjectSnapshot[] = [
  {
    key: CONTENT_PLATFORM!.key,
    label: CONTENT_PLATFORM!.label,
    owner: CONTENT_PLATFORM!.owner,
    repo: CONTENT_PLATFORM!.repo,
    openIdeas: 34,
    approved: 11,
    openPRs: 13,
    agents: 9,
    status: "building",
    lastActivity: "2026-08-31T00:16:33Z",
    unreachable: false,
  },
  {
    key: SUPPLY_CHAIN!.key,
    label: SUPPLY_CHAIN!.label,
    owner: SUPPLY_CHAIN!.owner,
    repo: SUPPLY_CHAIN!.repo,
    openIdeas: 0,
    approved: 0,
    openPRs: 0,
    agents: 9,
    status: "idle",
    lastActivity: null,
    unreachable: false,
  },
];

/* ------------------------------------------------------------------ */
/* Metrics ("/metrics")                                                */
/* ------------------------------------------------------------------ */

/**
 * `metrics/loop-metrics.json` from the repo, complete — all 54
 * daily snapshots from 2026-07-13 (the day the loop was installed) to
 * 2026-09-04.
 *
 * It is not a flattering curve, and it has not been smoothed. The first
 * fortnight is the loop finding its feet — one PR, then seven, then a merge
 * rate in the nineties while the owner was merging everything. Then the
 * rejections start, merge rate settles in the sixties, and from early August
 * the counters go flat: the loop kept opening PRs nobody had time to review.
 * That plateau is the subject of the repo's own retro issue (#128).
 */
export const DEMO_METRICS_HISTORY: MetricsSnapshot[] = [
  {
    date: "2026-07-13",
    prs_opened: 1,
    prs_merged: 1,
    prs_rejected: 0,
    prs_open_now: 0,
    merge_rate_pct: 100,
    median_pr_size_lines: 637,
    median_days_to_merge: 0.1,
    prs_needing_changes: 0,
    proposals_filed: 0,
    proposals_approved: 0,
    proposal_approval_rate_pct: null,
  },
  {
    date: "2026-07-14",
    prs_opened: 7,
    prs_merged: 6,
    prs_rejected: 1,
    prs_open_now: 0,
    merge_rate_pct: 86,
    median_pr_size_lines: 246,
    median_days_to_merge: 0,
    prs_needing_changes: 0,
    proposals_filed: 8,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-15",
    prs_opened: 14,
    prs_merged: 8,
    prs_rejected: 1,
    prs_open_now: 5,
    merge_rate_pct: 89,
    median_pr_size_lines: 266,
    median_days_to_merge: 0,
    prs_needing_changes: 1,
    proposals_filed: 11,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-16",
    prs_opened: 17,
    prs_merged: 9,
    prs_rejected: 1,
    prs_open_now: 7,
    merge_rate_pct: 90,
    median_pr_size_lines: 328,
    median_days_to_merge: 0,
    prs_needing_changes: 1,
    proposals_filed: 11,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-17",
    prs_opened: 21,
    prs_merged: 9,
    prs_rejected: 1,
    prs_open_now: 11,
    merge_rate_pct: 90,
    median_pr_size_lines: 329,
    median_days_to_merge: 0,
    prs_needing_changes: 1,
    proposals_filed: 12,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-18",
    prs_opened: 28,
    prs_merged: 9,
    prs_rejected: 1,
    prs_open_now: 18,
    merge_rate_pct: 90,
    median_pr_size_lines: 329,
    median_days_to_merge: 0,
    prs_needing_changes: 1,
    proposals_filed: 12,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-19",
    prs_opened: 28,
    prs_merged: 9,
    prs_rejected: 1,
    prs_open_now: 18,
    merge_rate_pct: 90,
    median_pr_size_lines: 329,
    median_days_to_merge: 0,
    prs_needing_changes: 1,
    proposals_filed: 12,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-20",
    prs_opened: 29,
    prs_merged: 12,
    prs_rejected: 1,
    prs_open_now: 16,
    merge_rate_pct: 92,
    median_pr_size_lines: 328,
    median_days_to_merge: 0,
    prs_needing_changes: 1,
    proposals_filed: 30,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-21",
    prs_opened: 29,
    prs_merged: 12,
    prs_rejected: 1,
    prs_open_now: 16,
    merge_rate_pct: 92,
    median_pr_size_lines: 328,
    median_days_to_merge: 0,
    prs_needing_changes: 1,
    proposals_filed: 31,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-22",
    prs_opened: 33,
    prs_merged: 16,
    prs_rejected: 1,
    prs_open_now: 16,
    merge_rate_pct: 94,
    median_pr_size_lines: 303,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 33,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-23",
    prs_opened: 34,
    prs_merged: 21,
    prs_rejected: 2,
    prs_open_now: 11,
    merge_rate_pct: 91,
    median_pr_size_lines: 295,
    median_days_to_merge: 0.8,
    prs_needing_changes: 1,
    proposals_filed: 35,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-24",
    prs_opened: 41,
    prs_merged: 21,
    prs_rejected: 9,
    prs_open_now: 11,
    merge_rate_pct: 70,
    median_pr_size_lines: 303,
    median_days_to_merge: 0.8,
    prs_needing_changes: 1,
    proposals_filed: 35,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-25",
    prs_opened: 41,
    prs_merged: 21,
    prs_rejected: 9,
    prs_open_now: 11,
    merge_rate_pct: 70,
    median_pr_size_lines: 303,
    median_days_to_merge: 0.8,
    prs_needing_changes: 1,
    proposals_filed: 35,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-26",
    prs_opened: 41,
    prs_merged: 21,
    prs_rejected: 9,
    prs_open_now: 11,
    merge_rate_pct: 70,
    median_pr_size_lines: 303,
    median_days_to_merge: 0.8,
    prs_needing_changes: 1,
    proposals_filed: 35,
    proposals_approved: 0,
    proposal_approval_rate_pct: 0,
  },
  {
    date: "2026-07-27",
    prs_opened: 41,
    prs_merged: 21,
    prs_rejected: 10,
    prs_open_now: 10,
    merge_rate_pct: 68,
    median_pr_size_lines: 303,
    median_days_to_merge: 0.8,
    prs_needing_changes: 1,
    proposals_filed: 53,
    proposals_approved: 18,
    proposal_approval_rate_pct: 34,
  },
  {
    date: "2026-07-28",
    prs_opened: 42,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 8,
    merge_rate_pct: 65,
    median_pr_size_lines: 316,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 53,
    proposals_approved: 19,
    proposal_approval_rate_pct: 36,
  },
  {
    date: "2026-07-29",
    prs_opened: 45,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 11,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 53,
    proposals_approved: 20,
    proposal_approval_rate_pct: 38,
  },
  {
    date: "2026-07-30",
    prs_opened: 45,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 11,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 53,
    proposals_approved: 20,
    proposal_approval_rate_pct: 38,
  },
  {
    date: "2026-07-31",
    prs_opened: 45,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 11,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 53,
    proposals_approved: 20,
    proposal_approval_rate_pct: 38,
  },
  {
    date: "2026-08-01",
    prs_opened: 45,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 11,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 53,
    proposals_approved: 20,
    proposal_approval_rate_pct: 38,
  },
  {
    date: "2026-08-02",
    prs_opened: 45,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 11,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 53,
    proposals_approved: 20,
    proposal_approval_rate_pct: 38,
  },
  {
    date: "2026-08-03",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-04",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-05",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-06",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-07",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-08",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-09",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-10",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-11",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-12",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-13",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-14",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-15",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-16",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-17",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-18",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-19",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-20",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-21",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-22",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-23",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-24",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 12,
    prs_open_now: 13,
    merge_rate_pct: 65,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-25",
    prs_opened: 47,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 12,
    merge_rate_pct: 63,
    median_pr_size_lines: 328,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-26",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-27",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-28",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-29",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-30",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-08-31",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-09-01",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-09-02",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-09-03",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
  {
    date: "2026-09-04",
    prs_opened: 48,
    prs_merged: 22,
    prs_rejected: 13,
    prs_open_now: 13,
    merge_rate_pct: 63,
    median_pr_size_lines: 329,
    median_days_to_merge: 1,
    prs_needing_changes: 1,
    proposals_filed: 54,
    proposals_approved: 21,
    proposal_approval_rate_pct: 39,
  },
];

/**
 * `LOOP-DASHBOARD.md` from the repo, rendered as-is on the Metrics page.
 *
 * The loop's Metrics workflow writes this file itself every morning, including
 * the "learning ledger" at the bottom — the owner's revealed preferences,
 * derived from what he approved, declined, and never answered. It is blunt
 * about the loop's own problems ("You are throwing away a lot of agent work"),
 * which is the point of it.
 */
export const DEMO_DASHBOARD_MD = `# Loop dashboard

*Auto-generated 2026-09-04. Do not edit by hand.*

**Mixed.** You are throwing away a lot of agent work. Read the retro issue.

## Is the work any good?

| | |
|---|---|
| Pull requests merged | 22 |
| Pull requests rejected | 13 |
| **Merge rate** | **63%** |
| Waiting on you right now | 13 |

## Is it outrunning you?

| | |
|---|---|
| Typical days to merge | 1 |
| Typical PR size (lines) | 329 |

If PR size climbs while merge rate falls, the agents are writing more and getting it
right less. That is the failure mode to watch for.

## Loop vs. everything else

Every table above is the loop's slice only. Here is that same slice next to your own
hand-made work, so the loop never looks like the whole repo when it isn't.

| | Loop | You (hand) | Whole repo |
|---|---|---|---|
| PRs merged | 22 | 22 | 44 |
| PRs rejected | 13 | 0 | 13 |
| Merge rate | 63% | 100% | 77% |
| Typical PR size (lines) | 329 | 270 | 329 |
| Typical days to merge | 1 | 0 | 0 |

## Are the ideas any good?

| | |
|---|---|
| Ideas filed (all time) | 54 |
| You approved | 21 |
| You declined | 0 |
| Still waiting on you | 23 |
| Untouched for over a week | 23 |
| **Approval rate** | **39%** |

A low approval rate means the scout is researching the wrong things. That is fixable —
it is written up in the weekly retro issue.

---

## Learning ledger — read this before proposing anything

*This section exists for the Scout. The three lists below are the owner's actual
revealed preferences: what he said yes to, what he said no to, and what he could not be
bothered to answer. Propose more like the first list, nothing like the second, and less
like the third.*

### ✅ Approved ideas — more like these

- #126 Apply the picked redesign: Style 2 "Warm Creator", light default, single nav
- #96 A sports video can hang for up to 30 minutes with no error — give it the same stall-timeout the other two video types already have
- #94 Some true-crime/history videos get their narration cut off halfway — and still auto-publish
- #90 Cut your AI writing bill by ~90% with prompt caching — same videos, lower cost
- #88 Stop TikTok from silently shadowbanning you — human-like posting + a 'your reach just died' alert
- #82 Some sports videos silently fail to render when the AI hook has a comma or % — fix the text escaping
- #77 Your TikTok videos are too short to ever earn — make a 60s+ cut for TikTok only
- #70 Video preview won't play on Mac/iPhone — you can't reliably review before it auto-posts
- #58 Auto-post every video to Instagram & Facebook too, not just YouTube + TikTok — the biggest free revenue bump on content you already make
- #57 Your paid premium voice can quietly break — the app swaps in the free robot voice and never tells you
- #51 The AI voice mispronounces names, places & acronyms — add a pronunciation step before every voiceover
- #49 Give the app a full visual redesign (with drafts to pick from), fewer tabs, and fix TikTok's silent posting failure
- #45 Stop an auto-posted true-crime video from calling a real, living person guilty — the legal safety check has holes and zero tests
- #43 Make the system learn from its own wins — 'make more of what's working' instead of a fixed calendar
- #27 Let the channel earn money before it's monetized: put links & CTAs on every video
- #26 Your spending cap doesn't actually stop spending — make the budget limit real
- #21 Stop the sports channel from getting killed by copyright strikes
- #19 Publish to TikTok and Instagram Reels, not just YouTube (3× the reach per video)
- #18 Give every video a strong hook — and learn which hooks actually win
- #17 Protect the channel from demonetization: extend the anti-repetition gate to every factory
- #15 Tell the owner WHY an auto-post didn't happen (instead of silently stopping)

### ❌ Declined ideas — never propose these or near-variants of them

_Nothing declined yet. No idea has ever been explicitly rejected, so there is no negative signal to learn from._

### 😴 Ignored for more than 7 days — a silent no

- #71 The app sometimes makes (and posts) the same video twice when two timers overlap
- #72 Show me which videos and niches actually EARN money, not just what they cost
- #73 Your spend numbers can be inflated (and providers billed twice) when a step retries
- #74 A TikTok video can show 'Posted' when it never actually went live — and never retries
- #75 Your captions & call-to-action can be hidden behind TikTok/Reels/Shorts buttons
- #76 Videos look blurry after upload — add clean per-platform export settings
- #78 Write titles & hashtags tuned to each platform, not one identical set for all three
- #79 Auto-add your links (affiliate/product) to every video's description — earn before you're monetized
- #83 You're posting to TikTok but never measuring it — pull TikTok view counts so it can win too
- #84 A blank BLACK video with just narration can auto-publish to YouTube — catch it before it goes live
- #86 Check every video against YouTube's 2026 'AI slop' demonetization rules BEFORE it posts
- #87 Turn each week's shorts into one long YouTube video — 50-200x the pay, and the only real path to getting monetized
- #89 You already score each video's hook — use it to skip publishing the ones likely to flop
- #85 The dashboard's "$ cost" isn't real money — label it as an estimate and fix the blank sports figure
- #100 Give YouTube and TikTok their own copy of each video, so they stop burying it as 'reused content'
- #101 Auto-make a click-worthy thumbnail for each video — right now there isn't one
- #102 A stalled sports data fetch can freeze a video run for 30 minutes — add the same timeout the true-crime pipeline already has
- #103 Add a high-paying niche (money/business explainers) — same effort per video, 2-4x the ad rate
- #109 Your sports videos skip the 'will this get demonetized?' safety check that true-crime and history already run
- #110 The crash-recovery safety net can wrongly kill a video that's still rendering — and make you pay to render it twice
- #114 TikTok auto-publish is silently broken whenever YouTube posts first — the second platform never goes live
- #115 Stop re-buying the same AI images every video — cache & reuse atmospheric stills to cut the image bill
- #118 Teach the app to copy your videos people actually WATCH — not just the ones that got shown
`;

/* ------------------------------------------------------------------ */
/* Tools ("/tools") — capability inventory                             */
/* ------------------------------------------------------------------ */

/** MCP servers wired in at the repo root (`.mcp.json`). */
const DEMO_REPO_MCP_SERVERS = ["github"];

/**
 * One card per baseline agent workflow, parsed from the real installed YAML
 * with the same regexes `lib/tools.ts` uses — same `--allowedTools` list,
 * same `--model`, same `Skill(...)` scan.
 *
 * The result is unglamorous and true: every agent runs on `opus` with a broad
 * tool grant (a direct consequence of the lesson in the repo's LEARNINGS.md
 * that `--allowedTools` REPLACES the default toolset rather than extending
 * it), only the Tool installer wires in an MCP config, and no workflow
 * references a Skill.
 */
const DEMO_TOOLS_AGENTS: AgentCapabilities[] = [
  {
    "file": "claude-scout.yml",
    "name": "Scout",
    "blurb": "Finds work, files proposals",
    "found": true,
    "isAgent": true,
    "model": "opus",
    "builtinTools": [
      "Run commands",
      "Read command output",
      "Stop commands",
      "Read files",
      "Find files",
      "Search code",
      "Spawn sub-agents",
      "Track a to-do list",
      "Search the web",
      "Read web pages"
    ],
    "mcpServers": [],
    "skills": [],
    "source": "main"
  },
  {
    "file": "claude-builder.yml",
    "name": "Builder",
    "blurb": "Writes code, opens PRs",
    "found": true,
    "isAgent": true,
    "model": "opus",
    "builtinTools": [
      "Run commands",
      "Read command output",
      "Stop commands",
      "Read files",
      "Write files",
      "Edit files",
      "Find files",
      "Search code",
      "Spawn sub-agents",
      "Track a to-do list",
      "Search the web",
      "Read web pages"
    ],
    "mcpServers": [],
    "skills": [],
    "source": "main"
  },
  {
    "file": "claude-audit.yml",
    "name": "Auditor",
    "blurb": "Reviews PRs",
    "found": true,
    "isAgent": true,
    "model": "opus",
    "builtinTools": [
      "Run commands",
      "Read command output",
      "Stop commands",
      "Read files",
      "Write files",
      "Edit files",
      "Find files",
      "Search code",
      "Spawn sub-agents",
      "Track a to-do list",
      "Search the web",
      "Read web pages"
    ],
    "mcpServers": [],
    "skills": [],
    "source": "main"
  },
  {
    "file": "claude-mention.yml",
    "name": "Mention",
    "blurb": "Replies to @claude",
    "found": true,
    "isAgent": true,
    "model": "opus",
    "builtinTools": [
      "Run commands",
      "Read command output",
      "Stop commands",
      "Read files",
      "Write files",
      "Edit files",
      "Find files",
      "Search code",
      "Spawn sub-agents",
      "Track a to-do list",
      "Search the web",
      "Read web pages"
    ],
    "mcpServers": [],
    "skills": [],
    "source": "main"
  },
  {
    "file": "claude-retro.yml",
    "name": "Retro",
    "blurb": "Reviews the loop",
    "found": true,
    "isAgent": true,
    "model": "opus",
    "builtinTools": [
      "Run commands",
      "Read command output",
      "Stop commands",
      "Read files",
      "Write files",
      "Edit files",
      "Find files",
      "Search code",
      "Spawn sub-agents",
      "Track a to-do list",
      "Search the web",
      "Read web pages"
    ],
    "mcpServers": [],
    "skills": [],
    "source": "main"
  },
  {
    "file": "claude-redraft.yml",
    "name": "Redraft",
    "blurb": "Rewrites proposals",
    "found": true,
    "isAgent": true,
    "model": "opus",
    "builtinTools": [
      "Run commands",
      "Read command output",
      "Stop commands",
      "Read files",
      "Find files",
      "Search code",
      "Spawn sub-agents",
      "Track a to-do list",
      "Search the web",
      "Read web pages"
    ],
    "mcpServers": [],
    "skills": [],
    "source": "main"
  },
  {
    "file": "claude-demo.yml",
    "name": "Demo",
    "blurb": "Captures evidence",
    "found": true,
    "isAgent": true,
    "model": "opus",
    "builtinTools": [
      "Run commands",
      "Read command output",
      "Stop commands",
      "Read files",
      "Write files",
      "Edit files",
      "Find files",
      "Search code",
      "Spawn sub-agents",
      "Track a to-do list",
      "Search the web",
      "Read web pages"
    ],
    "mcpServers": [],
    "skills": [],
    "source": "main"
  },
  {
    "file": "claude-tool-install.yml",
    "name": "Tool installer",
    "blurb": "Installs new tools",
    "found": true,
    "isAgent": true,
    "model": "opus",
    "builtinTools": [
      "Run commands",
      "Read command output",
      "Stop commands",
      "Read files",
      "Write files",
      "Edit files",
      "Find files",
      "Search code",
      "Spawn sub-agents",
      "Track a to-do list",
      "Search the web",
      "Read web pages"
    ],
    "mcpServers": [
      "github"
    ],
    "skills": [],
    "source": "main"
  },
];

/**
 * Reuses the real `computeSharedCapabilities` (intersection across agents,
 * plus repo-root MCP servers) instead of hand-maintaining a second copy of
 * that logic that could silently drift from what the live page computes.
 */
export const DEMO_TOOLS_SHARED: SharedCapabilities = computeSharedCapabilities(
  DEMO_TOOLS_AGENTS,
  DEMO_REPO_MCP_SERVERS,
);

export const DEMO_CAPABILITY_INVENTORY = {
  agents: DEMO_TOOLS_AGENTS,
  shared: DEMO_TOOLS_SHARED,
};
