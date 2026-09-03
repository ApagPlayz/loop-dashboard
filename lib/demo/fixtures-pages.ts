/**
 * Demo payloads for server-rendered PAGES (as opposed to `/api/*` routes).
 *
 * Why this file exists separately from `lib/demo/api-fixtures.ts`: a page's
 * Server Component calls `lib/` functions directly — `loadOverview()`,
 * `getFileContent()`, `loadCapabilityInventory()` — instead of fetching its
 * own `/api/*` route, so it never passes through the proxy's anonymous-GET
 * interception. Each of those calls would otherwise try to read a GitHub repo
 * that doesn't exist (`loop-demo/aurora-notes`) and either throw or degrade to
 * an "unreachable" empty state. This file holds what those pages render
 * instead, once they've established (via `isPublicViewer()`) that the visitor
 * is anonymous.
 *
 * Same invented-content rules as every other demo fixture: no real repo
 * names, no real issue/PR text, no filesystem paths. Every shared id/date/
 * count is pulled from `lib/demo/world.ts` so this file's story agrees with
 * whatever the `/api/*` fixtures (owned by other agents) are showing for the
 * same two demo projects.
 */

import type { ProjectSnapshot } from "@/lib/overview";
import {
  computeSharedCapabilities,
  type AgentCapabilities,
  type SharedCapabilities,
} from "@/lib/tools";
import type { Snapshot as MetricsSnapshot } from "@/app/(app)/metrics/page";
import { DEMO_PROJECTS, demoTime } from "@/lib/demo/world";

/* ------------------------------------------------------------------ */
/* Overview ("/")                                                      */
/* ------------------------------------------------------------------ */

const [AURORA_NOTES, TIDEPOOL_API] = DEMO_PROJECTS;

/**
 * Snapshots for the two demo projects. Deliberately gives them DIFFERENT
 * statuses (one "building", one "active") rather than two copies of the same
 * numbers — a demo where every card looks identical reads as fake in a way a
 * pair of merely-plausible-but-different ones doesn't.
 */
export const DEMO_OVERVIEW: ProjectSnapshot[] = [
  {
    key: AURORA_NOTES!.key,
    label: AURORA_NOTES!.label,
    owner: AURORA_NOTES!.owner,
    repo: AURORA_NOTES!.repo,
    openIdeas: 5,
    approved: 2,
    openPRs: 2,
    agents: 9,
    status: "building",
    lastActivity: demoTime(38), // 38 minutes before the snapshot
    unreachable: false,
  },
  {
    key: TIDEPOOL_API!.key,
    label: TIDEPOOL_API!.label,
    owner: TIDEPOOL_API!.owner,
    repo: TIDEPOOL_API!.repo,
    openIdeas: 3,
    approved: 1,
    openPRs: 0,
    agents: 9,
    status: "active",
    lastActivity: demoTime(20 * 60), // ~20 hours before the snapshot
    unreachable: false,
  },
];

/* ------------------------------------------------------------------ */
/* Metrics ("/metrics")                                                */
/* ------------------------------------------------------------------ */

/**
 * Ten days of `metrics/loop-metrics.json`-shaped history, ending on the
 * frozen snapshot date. Chosen to show a visible improving trend — merge rate
 * climbing, PR size and time-to-merge shrinking — because a metrics page that
 * shows one flat number in every row looks like a stub, not a working loop.
 */
export const DEMO_METRICS_HISTORY: MetricsSnapshot[] = [
  {
    date: "2026-08-24",
    prs_opened: 3,
    prs_merged: 1,
    prs_rejected: 1,
    prs_open_now: 4,
    merge_rate_pct: 33,
    median_pr_size_lines: 210,
    median_days_to_merge: 2.1,
    prs_needing_changes: 1,
    proposals_filed: 4,
    proposals_approved: 2,
    proposal_approval_rate_pct: 50,
  },
  {
    date: "2026-08-25",
    prs_opened: 4,
    prs_merged: 2,
    prs_rejected: 0,
    prs_open_now: 6,
    merge_rate_pct: 50,
    median_pr_size_lines: 195,
    median_days_to_merge: 1.8,
    prs_needing_changes: 2,
    proposals_filed: 3,
    proposals_approved: 2,
    proposal_approval_rate_pct: 67,
  },
  {
    date: "2026-08-26",
    prs_opened: 2,
    prs_merged: 3,
    prs_rejected: 1,
    prs_open_now: 4,
    merge_rate_pct: 60,
    median_pr_size_lines: 180,
    median_days_to_merge: 1.6,
    prs_needing_changes: 1,
    proposals_filed: 5,
    proposals_approved: 3,
    proposal_approval_rate_pct: 60,
  },
  {
    date: "2026-08-27",
    prs_opened: 5,
    prs_merged: 3,
    prs_rejected: 0,
    prs_open_now: 6,
    merge_rate_pct: 63,
    median_pr_size_lines: 175,
    median_days_to_merge: 1.5,
    prs_needing_changes: 2,
    proposals_filed: 4,
    proposals_approved: 3,
    proposal_approval_rate_pct: 75,
  },
  {
    date: "2026-08-28",
    prs_opened: 3,
    prs_merged: 4,
    prs_rejected: 1,
    prs_open_now: 4,
    merge_rate_pct: 71,
    median_pr_size_lines: 160,
    median_days_to_merge: 1.3,
    prs_needing_changes: 1,
    proposals_filed: 3,
    proposals_approved: 2,
    proposal_approval_rate_pct: 67,
  },
  {
    date: "2026-08-29",
    prs_opened: 4,
    prs_merged: 4,
    prs_rejected: 0,
    prs_open_now: 4,
    merge_rate_pct: 75,
    median_pr_size_lines: 150,
    median_days_to_merge: 1.2,
    prs_needing_changes: 1,
    proposals_filed: 4,
    proposals_approved: 3,
    proposal_approval_rate_pct: 75,
  },
  {
    date: "2026-08-30",
    prs_opened: 3,
    prs_merged: 5,
    prs_rejected: 0,
    prs_open_now: 2,
    merge_rate_pct: 80,
    median_pr_size_lines: 140,
    median_days_to_merge: 1.1,
    prs_needing_changes: 0,
    proposals_filed: 3,
    proposals_approved: 3,
    proposal_approval_rate_pct: 100,
  },
  {
    date: "2026-08-31",
    prs_opened: 5,
    prs_merged: 5,
    prs_rejected: 0,
    prs_open_now: 2,
    merge_rate_pct: 83,
    median_pr_size_lines: 135,
    median_days_to_merge: 1.0,
    prs_needing_changes: 1,
    proposals_filed: 5,
    proposals_approved: 4,
    proposal_approval_rate_pct: 80,
  },
  {
    date: "2026-09-01",
    prs_opened: 4,
    prs_merged: 6,
    prs_rejected: 0,
    prs_open_now: 1,
    merge_rate_pct: 86,
    median_pr_size_lines: 130,
    median_days_to_merge: 0.9,
    prs_needing_changes: 0,
    proposals_filed: 4,
    proposals_approved: 4,
    proposal_approval_rate_pct: 100,
  },
  {
    date: "2026-09-02",
    prs_opened: 3,
    prs_merged: 6,
    prs_rejected: 1,
    prs_open_now: 1,
    merge_rate_pct: 89,
    median_pr_size_lines: 125,
    median_days_to_merge: 0.8,
    prs_needing_changes: 0,
    proposals_filed: 3,
    proposals_approved: 3,
    proposal_approval_rate_pct: 100,
  },
];

/**
 * `LOOP-DASHBOARD.md`, rendered as-is on the Metrics page. This is the one
 * piece of demo copy most likely to actually be READ start to finish (by a
 * recruiter clicking around), so it explains the real product in plain
 * English rather than standing in as a placeholder paragraph.
 */
export const DEMO_DASHBOARD_MD = `# How this loop works

This project is developed by nine small agents instead of one person typing
into an editor. Each agent has one job, runs on its own trigger (a schedule, a
label, a comment), and hands off to the next stage through ordinary GitHub
objects — issues, pull requests, labels — so the whole thing stays inspectable
from the GitHub UI alone, with this dashboard layered on top for a friendlier
view.

## The nine agents

1. **Scout** — researches the codebase and the wider ecosystem on an hourly
   schedule and files new ideas as GitHub issues. It never writes code; it
   only keeps the idea queue stocked, capped at 8 open ideas at a time so it
   never turns into noise.
2. **Redraft** — when an idea gets sent back with feedback (a \`redraft\`
   label and a comment), this agent rewrites the issue to match the feedback
   and returns it to the queue for another look.
3. **Builder** — picks the strongest idea in the queue — anything approved
   jumps ahead of everything else — and does the work: writes the code, runs
   the checks, and opens exactly one pull request from a \`claude/\` branch.
4. **Auditor** — reviews every pull request the Builder opens by running
   several independent, adversarial reviewers over the diff and posting one
   verdict: ship it, fix something first, or do not merge.
5. **Demo** — actually runs the change and captures screenshots or video as
   evidence, then posts it to the pull request, so a human can see the change
   working before spending time reading the diff.
6. **Retro** — once a week, looks back over what got approved, ignored, or
   merged, and proposes edits to the other agents' own instructions so the
   loop improves itself over time instead of repeating the same mistakes.
7. **Metrics** — a plain scheduled job, no AI involved, that gathers the
   loop's numbers each morning and writes the snapshot this very page reads.
8. **@mention** — the remote control. Typing \`@claude\` followed by a request
   in any issue or pull-request comment — including from a phone — wakes an
   agent that does the work and replies inline.
9. **Tool installer** — when a new capability (an MCP server, a skill, a
   connected service) gets requested from the Tools section, this agent wires
   it into the right agent's workflow file.

## How a change actually flows

A typical change moves through the loop like this:

\`\`\`
Scout finds an idea
   -> files a GitHub issue (the "ideas" queue)
   -> a person approves it, or Redraft rewrites it after feedback
   -> Builder implements it and opens a pull request
   -> Auditor reviews the diff and posts a verdict
   -> Demo captures screenshots/video as evidence
   -> a person reviews the evidence and merges
   -> Metrics records the outcome in the next daily snapshot
   -> Retro reads a week of outcomes and tunes the other agents
\`\`\`

Every step after "a person approves it" can also be triggered by @mentioning
\`@claude\` directly on an issue or pull request, so the loop is steerable
without ever leaving GitHub's own comment threads.

## Why it's shaped this way

Nine small, single-purpose agents are easier to reason about — and to debug
when one misbehaves — than one large agent trying to do the whole job at
once. Each stage leaves a paper trail (an issue, a labeled comment, a PR
review) that both a human and the next agent in the chain can read, so the
loop's own history is the audit log.

*This page is a frozen demo snapshot, not a live feed — see the banner at the
top of the app.*
`;

/* ------------------------------------------------------------------ */
/* Tools ("/tools") — capability inventory                             */
/* ------------------------------------------------------------------ */

/**
 * MCP servers wired in at the repo root (`.mcp.json`), so every agent that
 * references an MCP config gets them — mirrors how `loadCapabilityInventory`
 * treats `repoMcpServers` for real.
 */
const DEMO_REPO_MCP_SERVERS = ["github"];

/**
 * One card per baseline agent workflow (matches `AGENT_WORKFLOWS` in
 * lib/tools.ts, minus `metrics` — that one runs a plain script, not
 * `claude-code-action`, so it never gets a capability card there either).
 */
const DEMO_TOOLS_AGENTS: AgentCapabilities[] = [
  {
    file: "claude-scout.yml",
    name: "Scout",
    blurb: "Finds work, files proposals",
    found: true,
    isAgent: true,
    model: "claude-sonnet-4-5",
    builtinTools: [
      "Run commands",
      "Read files",
      "Search code",
      "Find files",
      "Search the web",
      "Read web pages",
    ],
    mcpServers: ["github"],
    skills: ["market-research"],
    source: "main",
  },
  {
    file: "claude-builder.yml",
    name: "Builder",
    blurb: "Writes code, opens PRs",
    found: true,
    isAgent: true,
    model: "claude-sonnet-4-5",
    builtinTools: [
      "Run commands",
      "Read files",
      "Write files",
      "Edit files",
      "Search code",
      "Find files",
      "Spawn sub-agents",
    ],
    mcpServers: ["github"],
    skills: ["code-review"],
    source: "main",
  },
  {
    file: "claude-audit.yml",
    name: "Auditor",
    blurb: "Reviews PRs",
    found: true,
    isAgent: true,
    model: "claude-opus-4-1",
    builtinTools: ["Run commands", "Read files", "Search code", "Find files"],
    mcpServers: ["github"],
    skills: ["code-review"],
    source: "main",
  },
  {
    file: "claude-mention.yml",
    name: "Mention",
    blurb: "Replies to @claude",
    found: true,
    isAgent: true,
    model: "claude-sonnet-4-5",
    builtinTools: [
      "Run commands",
      "Read files",
      "Write files",
      "Edit files",
      "Search code",
      "Find files",
      "Search the web",
    ],
    mcpServers: ["github"],
    skills: [],
    source: "main",
  },
  {
    file: "claude-retro.yml",
    name: "Retro",
    blurb: "Reviews the loop",
    found: true,
    isAgent: true,
    model: "claude-sonnet-4-5",
    builtinTools: ["Run commands", "Read files", "Write files", "Search code", "Find files"],
    mcpServers: ["github"],
    skills: [],
    source: "main",
  },
  {
    file: "claude-redraft.yml",
    name: "Redraft",
    blurb: "Rewrites proposals",
    found: true,
    isAgent: true,
    model: "claude-sonnet-4-5",
    builtinTools: ["Run commands", "Read files", "Write files", "Edit files"],
    mcpServers: ["github"],
    skills: [],
    source: "main",
  },
  {
    file: "claude-demo.yml",
    name: "Demo",
    blurb: "Captures evidence",
    found: true,
    isAgent: true,
    model: "claude-sonnet-4-5",
    builtinTools: ["Run commands", "Read files", "Write files", "Find files"],
    mcpServers: ["github", "playwright"],
    skills: [],
    source: "main",
  },
  {
    file: "claude-tool-install.yml",
    name: "Tool installer",
    blurb: "Installs new tools",
    found: true,
    isAgent: true,
    model: "claude-sonnet-4-5",
    builtinTools: [
      "Run commands",
      "Read files",
      "Write files",
      "Edit files",
      "Search code",
      "Find files",
    ],
    mcpServers: ["github"],
    skills: [],
    source: "main",
  },
];

/**
 * Reuses the real `computeSharedCapabilities` (intersection across agents,
 * plus repo-root MCP servers) instead of hand-maintaining a second copy of
 * that logic that could silently drift from what the live page actually
 * computes.
 */
export const DEMO_TOOLS_SHARED: SharedCapabilities = computeSharedCapabilities(
  DEMO_TOOLS_AGENTS,
  DEMO_REPO_MCP_SERVERS,
);

export const DEMO_CAPABILITY_INVENTORY = {
  agents: DEMO_TOOLS_AGENTS,
  shared: DEMO_TOOLS_SHARED,
};
