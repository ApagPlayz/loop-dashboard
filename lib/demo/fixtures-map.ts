/**
 * Demo fixtures for the Process Map section (`/api/map/**` and
 * `/api/launch/status`).
 *
 * These are the ONLY responses an anonymous visitor can get from these
 * routes — see lib/demo/types.ts. Every value below is invented for the
 * fictional "Aurora Notes" demo project (and its quieter sibling "Tidepool
 * API"); nothing here is real GitHub data, a real repo, a real owner handle,
 * a real token, or a real filesystem path. See lib/demo/world.ts for the
 * shared constants this file is built from and the reasoning for why the
 * data is fictional rather than sourced from the dashboard's own private
 * repo. NOTHING REAL MAY GO IN THIS FILE — if you're tempted to paste in a
 * real run id, commit sha, or workflow output to "make it look right",
 * invent one instead.
 */

import type { DemoFixture } from "@/lib/demo/types";
import {
  DEMO_DEFAULT_PROJECT,
  DEMO_OWNER,
  DEMO_PROJECTS,
  DEMO_RUN_IDS,
  DEMO_SHAS,
  demoRepoUrl,
  demoTime,
} from "@/lib/demo/world";
import { AGENTS } from "@/lib/map-agents";
import type {
  AgentDetail,
  AgentMeta,
  AgentStatus,
  Capabilities,
  FileChange,
  HistoryCommit,
  MapStatus,
  RunSummary,
} from "@/lib/map-types";

/* ------------------------------------------------------------------ */
/* Small local helpers                                                 */
/* ------------------------------------------------------------------ */

const TIDEPOOL = DEMO_PROJECTS[1]!; // "tidepool-api" — the quieter second project

/** GitHub Actions run URL for a given run id, scoped to the demo repo. */
function runUrl(id: number): string {
  return demoRepoUrl(`actions/runs/${id}`);
}

/** Commit history URL for one workflow file. */
function historyUrlFor(file: string): string {
  return `https://github.com/${DEMO_OWNER}/${DEMO_DEFAULT_PROJECT.repo}/commits/main/.github/workflows/${file}`;
}

/** Extra run ids beyond the handful shared in world.ts — local to this file. */
const EXTRA_RUN_IDS = {
  metrics: 18421388,
  retro: 18408710,
  redraft: 18415502,
  toolinstall: 18379244,
  auditOlder1: 18420110,
  auditOlder2: 18418877,
  builderOlder1: 18419900,
  builderOlder2: 18418302,
  scoutOlder1: 18420655,
  scoutOlder2: 18418010,
  demoOlder1: 18410502,
  demoOlder2: 18408998,
} as const;

/* ------------------------------------------------------------------ */
/* /api/map/projects                                                   */
/* ------------------------------------------------------------------ */

const PROJECTS_FIXTURE: DemoFixture = {
  match: "/api/map/projects",
  body: () => ({ projects: DEMO_PROJECTS }),
};

/* ------------------------------------------------------------------ */
/* /api/map/status                                                     */
/* ------------------------------------------------------------------ */

/**
 * Per-agent live badge for Aurora Notes. Two workflows (redraft, tool
 * installer) are switched off so the power toggle / disabled-agent styling
 * has something real to show; everything else is on. Statuses are a mix of
 * success and one failure (Demo) so the map doesn't look artificially
 * perfect.
 */
const AURORA_AGENT_STATUS: AgentStatus[] = AGENTS.map((meta) => {
  const base = {
    id: meta.id,
    file: meta.file,
    label: meta.label,
    tagline: meta.tagline,
    generic: false,
  };
  switch (meta.id) {
    case "scout":
      return {
        ...base,
        enabled: true,
        status: "completed",
        conclusion: "success",
        createdAt: demoTime(35),
        url: runUrl(DEMO_RUN_IDS.scout),
      };
    case "redraft":
      // Switched off on purpose (a couple of workflows disabled, per the
      // demo brief) — no recent run to show either.
      return {
        ...base,
        enabled: false,
        status: null,
        conclusion: null,
        createdAt: null,
        url: null,
      };
    case "builder":
      return {
        ...base,
        enabled: true,
        status: "completed",
        conclusion: "success",
        createdAt: demoTime(40),
        url: runUrl(DEMO_RUN_IDS.builder),
      };
    case "audit":
      return {
        ...base,
        enabled: true,
        status: "completed",
        conclusion: "success",
        createdAt: demoTime(38),
        url: runUrl(DEMO_RUN_IDS.auditor),
      };
    case "demo":
      // The one failure in the mix — Demo evidence capture flaked on a
      // headless-browser timeout, which is a believable real-world failure.
      return {
        ...base,
        enabled: true,
        status: "completed",
        conclusion: "failure",
        createdAt: demoTime(20),
        url: runUrl(DEMO_RUN_IDS.demo),
      };
    case "retro":
      return {
        ...base,
        enabled: true,
        status: "completed",
        conclusion: "success",
        createdAt: demoTime(60 * 24 * 2), // last Sunday evening
        url: runUrl(EXTRA_RUN_IDS.retro),
      };
    case "metrics":
      return {
        ...base,
        enabled: true,
        status: "completed",
        conclusion: "success",
        createdAt: demoTime(120),
        url: runUrl(DEMO_RUN_IDS.tests),
      };
    case "mention":
      // The phone remote control — quiet until used, so no recent run.
      return {
        ...base,
        enabled: true,
        status: null,
        conclusion: null,
        createdAt: null,
        url: null,
      };
    case "toolinstall":
      // Also switched off — the second of the "a couple disabled" pair.
      return {
        ...base,
        enabled: false,
        status: "completed",
        conclusion: "success",
        createdAt: demoTime(60 * 24 * 6),
        url: runUrl(EXTRA_RUN_IDS.toolinstall),
      };
    default:
      return { ...base, enabled: true, status: null, conclusion: null, createdAt: null, url: null };
  }
});

/** Tidepool API is a newer, quieter project — every agent present but idle. */
const TIDEPOOL_AGENT_STATUS: AgentStatus[] = AGENTS.map((meta) => ({
  id: meta.id,
  file: meta.file,
  label: meta.label,
  tagline: meta.tagline,
  generic: false,
  enabled: true,
  status: meta.id === "scout" ? "completed" : null,
  conclusion: meta.id === "scout" ? "success" : null,
  createdAt: meta.id === "scout" ? demoTime(200) : null,
  url: meta.id === "scout" ? runUrl(EXTRA_RUN_IDS.scoutOlder1) : null,
}));

function statusFor(projectKey: string): MapStatus {
  if (projectKey === TIDEPOOL.key) {
    return {
      proposals: 3,
      approved: 0,
      openPRs: 0,
      agents: TIDEPOOL_AGENT_STATUS,
      project: TIDEPOOL.key,
      // false: the map renders in its normal running state, not the paused banner.
      loopPaused: false,
      aiEnabled: true,
    };
  }
  return {
    proposals: 5,
    approved: 2,
    openPRs: 1,
    agents: AURORA_AGENT_STATUS,
    project: DEMO_DEFAULT_PROJECT.key,
    // Only 2 of 8 pausable workflows are off, so the loop as a whole is not
    // paused — the "Paused" banner and pauseRecord recovery flow are covered
    // separately by /api/map/power below.
    loopPaused: false,
    aiEnabled: true,
  };
}

const STATUS_FIXTURE: DemoFixture = {
  match: "/api/map/status",
  body: (url) => statusFor(url.searchParams.get("project") ?? DEMO_DEFAULT_PROJECT.key),
};

/* ------------------------------------------------------------------ */
/* /api/map/agent/[id]                                                 */
/* ------------------------------------------------------------------ */

const CAPABILITIES: Record<string, Capabilities> = {
  scout: { tools: ["WebSearch", "WebFetch", "Read", "Grep"], mcpServers: ["github"], skills: [] },
  redraft: { tools: ["Read", "Edit"], mcpServers: ["github"], skills: [] },
  builder: {
    tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
    mcpServers: ["github"],
    skills: ["code-review"],
  },
  audit: { tools: ["Read", "Grep", "Bash"], mcpServers: ["github"], skills: ["code-review"] },
  demo: { tools: ["Bash", "Read"], mcpServers: ["github", "playwright"], skills: [] },
  retro: { tools: ["Read", "Edit", "Grep"], mcpServers: ["github"], skills: [] },
  metrics: { tools: ["Bash", "Read"], mcpServers: [], skills: [] },
  mention: { tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"], mcpServers: ["github"], skills: [] },
  toolinstall: { tools: ["Read", "Edit", "Write"], mcpServers: ["github"], skills: [] },
};

const PROMPTS: Record<string, string> = {
  scout:
    "You are the SCOUT for Aurora Notes, a note-taking app. Once an hour, research the market and this codebase for ideas worth building. File each idea as a GitHub issue labeled 'proposal' with a clear title and a short plain-English pitch. Never write code. Keep at most 8 open proposals — if the queue is full, only file something clearly better than what's already there.",
  redraft:
    "You are the REDRAFT agent. You've been handed back an idea with the 'redraft' label and a comment explaining what to change. Rewrite the idea to match that feedback, keep the same issue, and remove the 'redraft' label when you're done.",
  builder:
    "You are the BUILDER for Aurora Notes. Pick the single strongest open idea — anything labeled 'approved' jumps the queue — and implement it completely. Open exactly one pull request from a 'claude/' branch. Write a clear PR description explaining what changed and why.",
  demo:
    "You are the DEMO agent. Given a pull request number, check out the branch, run the app, and capture screenshots (and video where it helps) proving the change works. Upload the evidence to the PR and post a short '📸 Demo evidence' comment.",
  retro:
    "You are the RETRO agent. Once a week, look back at what got approved, redrafted, ignored, or merged. Propose edits to the loop's shared lessons file and to the other agents' own instructions so the system improves over time. Open a PR for review — never edit another agent's prompt directly.",
  toolinstall:
    "You are the TOOL INSTALLER. You've been asked to wire a new tool, skill, or connected service into one of the loop's workflows. Make the minimal YAML change needed, verify the workflow still parses, and open a PR.",
};

const RAW_YAML: Record<string, string> = {
  "claude-scout.yml": `name: Scout
on:
  schedule:
    - cron: "17 * * * *"
  workflow_dispatch: {}
permissions:
  contents: read
  issues: write
jobs:
  scout:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          claude_args: >-
            --allowedTools "WebSearch,WebFetch,Read,Grep"
            --mcp-config .mcp.json
          prompt: |
            You are the SCOUT for Aurora Notes, a note-taking app. Once an
            hour, research the market and this codebase for ideas worth
            building. File each idea as a GitHub issue labeled 'proposal'
            with a clear title and a short plain-English pitch. Never write
            code. Keep at most 8 open proposals — if the queue is full, only
            file something clearly better than what's already there.
`,
  "claude-redraft.yml": `name: Redraft
on:
  issues:
    types: [labeled]
  workflow_dispatch:
    inputs:
      issue_number:
        description: "Idea number to redraft"
        required: true
permissions:
  contents: read
  issues: write
jobs:
  redraft:
    if: github.event.label.name == 'redraft' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          claude_args: >-
            --allowedTools "Read,Edit"
            --mcp-config .mcp.json
          prompt: |
            You are the REDRAFT agent. You've been handed back an idea with
            the 'redraft' label and a comment explaining what to change.
            Rewrite the idea to match that feedback, keep the same issue,
            and remove the 'redraft' label when you're done.
`,
  "claude-builder.yml": `name: Builder
on:
  issues:
    types: [labeled]
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch: {}
permissions:
  contents: write
  issues: read
  pull-requests: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          claude_args: >-
            --allowedTools "Read,Edit,Write,Bash,Grep,Glob"
            --mcp-config .mcp.json
            --skill code-review
          prompt: |
            You are the BUILDER for Aurora Notes. Pick the single strongest
            open idea — anything labeled 'approved' jumps the queue — and
            implement it completely. Open exactly one pull request from a
            'claude/' branch. Write a clear PR description explaining what
            changed and why.
`,
  "claude-audit.yml": `name: Auditor
on:
  pull_request:
    types: [opened, synchronize]
permissions:
  contents: read
  pull-requests: write
jobs:
  audit:
    if: startsWith(github.head_ref, 'claude/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          claude_args: >-
            --allowedTools "Read,Grep,Bash"
            --mcp-config .mcp.json
            --skill code-review
          append_system_prompt: |
            You are five adversarial reviewers in sequence: correctness,
            security, performance, tests, and product fit. Post ONE verdict
            comment: SHIP, FIX FIRST, or DO NOT MERGE, with your reasoning.
`,
  "claude-demo.yml": `name: Demo
on:
  pull_request:
    types: [opened, synchronize]
  workflow_dispatch:
    inputs:
      pr_number:
        description: "Pull request number"
        required: true
permissions:
  contents: read
  pull-requests: write
jobs:
  demo:
    if: startsWith(github.head_ref, 'claude/') || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          claude_args: >-
            --allowedTools "Bash,Read"
            --mcp-config .mcp.json
          prompt: |
            You are the DEMO agent. Given a pull request number, check out
            the branch, run the app, and capture screenshots (and video
            where it helps) proving the change works. Upload the evidence
            to the PR and post a short '📸 Demo evidence' comment.
`,
  "claude-retro.yml": `name: Retro
on:
  schedule:
    - cron: "0 20 * * 0"
  workflow_dispatch: {}
permissions:
  contents: write
  issues: read
  pull-requests: read
jobs:
  retro:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          claude_args: >-
            --allowedTools "Read,Edit,Grep"
            --mcp-config .mcp.json
          prompt: |
            You are the RETRO agent. Once a week, look back at what got
            approved, redrafted, ignored, or merged. Propose edits to the
            loop's shared lessons file and to the other agents' own
            instructions so the system improves over time. Open a PR for
            review — never edit another agent's prompt directly.
`,
  "loop-metrics.yml": `name: Loop metrics
on:
  schedule:
    - cron: "0 7 * * *"
  pull_request: {}
  workflow_dispatch: {}
permissions:
  contents: read
  issues: read
  pull-requests: read
  actions: read
jobs:
  metrics:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Gather and write the daily summary
        run: node scripts/loop-metrics.mjs
`,
  "claude-mention.yml": `name: Mention
on:
  issue_comment:
    types: [created]
  issues:
    types: [opened]
permissions:
  contents: write
  issues: write
  pull-requests: write
jobs:
  mention:
    if: contains(github.event.comment.body, '@claude') || contains(github.event.issue.body, '@claude')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          claude_args: >-
            --allowedTools "Read,Edit,Write,Bash,Grep,Glob"
            --mcp-config .mcp.json
          append_system_prompt: |
            You are the whole loop, reachable from a phone. Do what the
            comment asks — answer, edit, or open a PR — then reply.
`,
  "claude-tool-install.yml": `name: Tool installer
on:
  repository_dispatch:
    types: [tool-install]
permissions:
  contents: write
  pull-requests: write
jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          claude_args: >-
            --allowedTools "Read,Edit,Write"
            --mcp-config .mcp.json
          prompt: |
            You are the TOOL INSTALLER. You've been asked to wire a new
            tool, skill, or connected service into one of the loop's
            workflows. Make the minimal YAML change needed, verify the
            workflow still parses, and open a PR.
`,
};

/** Five most-recent runs for one agent, newest first, mixing conclusions. */
function runsFor(id: string): RunSummary[] {
  const recent = AURORA_AGENT_STATUS.find((a) => a.id === id) ?? null;
  const older: { idOffset: number; minutesBefore: number; conclusion: string }[] =
    {
      scout: [
        { idOffset: EXTRA_RUN_IDS.scoutOlder1, minutesBefore: 95, conclusion: "success" },
        { idOffset: EXTRA_RUN_IDS.scoutOlder2, minutesBefore: 155, conclusion: "success" },
      ],
      builder: [
        { idOffset: EXTRA_RUN_IDS.builderOlder1, minutesBefore: 300, conclusion: "success" },
        { idOffset: EXTRA_RUN_IDS.builderOlder2, minutesBefore: 640, conclusion: "failure" },
      ],
      audit: [
        { idOffset: EXTRA_RUN_IDS.auditOlder1, minutesBefore: 305, conclusion: "success" },
        { idOffset: EXTRA_RUN_IDS.auditOlder2, minutesBefore: 645, conclusion: "success" },
      ],
      demo: [
        { idOffset: EXTRA_RUN_IDS.demoOlder1, minutesBefore: 310, conclusion: "success" },
        { idOffset: EXTRA_RUN_IDS.demoOlder2, minutesBefore: 650, conclusion: "success" },
      ],
    }[id] ?? [];

  const runs: RunSummary[] = [];
  if (recent?.status === "completed") {
    const startMin = (() => {
      switch (id) {
        case "scout":
          return 35;
        case "builder":
          return 40;
        case "audit":
          return 38;
        case "demo":
          return 20;
        case "retro":
          return 60 * 24 * 2;
        case "metrics":
          return 120;
        case "toolinstall":
          return 60 * 24 * 6;
        default:
          return 60;
      }
    })();
    runs.push({
      id: Number(recent.url?.split("/").pop() ?? 0),
      status: recent.status,
      conclusion: recent.conclusion,
      createdAt: recent.createdAt,
      updatedAt: demoTime(Math.max(0, startMin - 4)),
      durationSec: recent.conclusion === "failure" ? 145 : 260,
      url: recent.url ?? runUrl(0),
    });
  }
  for (const o of older) {
    runs.push({
      id: o.idOffset,
      status: "completed",
      conclusion: o.conclusion,
      createdAt: demoTime(o.minutesBefore),
      updatedAt: demoTime(Math.max(0, o.minutesBefore - 4)),
      durationSec: o.conclusion === "failure" ? 160 : 240,
      url: runUrl(o.idOffset),
    });
  }
  return runs.slice(0, 5);
}

function agentMetaById(id: string): AgentMeta | undefined {
  return AGENTS.find((a) => a.id === id);
}

function agentDetailFor(id: string): AgentDetail | null {
  const meta = agentMetaById(id);
  if (!meta) return null;

  const rawYaml = RAW_YAML[meta.file] ?? null;
  const capabilities = CAPABILITIES[id] ?? { tools: [], mcpServers: [], skills: [] };

  // Metrics is a plain script — no Claude prompt to extract, same as the real
  // extractor would report for a workflow with no `prompt: |` block.
  const promptExtractable = id !== "metrics";
  const prompt = promptExtractable ? PROMPTS[id] ?? null : null;

  return {
    meta,
    runs: runsFor(id),
    capabilities,
    ref: "main",
    fileFound: rawYaml !== null,
    prompt,
    rawYaml,
    promptExtractable,
    extractionNote: promptExtractable
      ? undefined
      : "This is a plain reporting script — it doesn't call Claude, so there's no prompt to show.",
    editable: rawYaml !== null,
    historyUrl: historyUrlFor(meta.file),
    aiEnabled: true,
  };
}

const AGENT_DETAIL_FIXTURE: DemoFixture = {
  match: /^\/api\/map\/agent\/[^/]+$/,
  body: (url) => {
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    // Fall back to the Scout so a stray/unknown id still renders something
    // sensible rather than an empty drawer.
    return agentDetailFor(id) ?? agentDetailFor("scout");
  },
};

/* ------------------------------------------------------------------ */
/* /api/map/history + /api/map/history/[sha]                           */
/* ------------------------------------------------------------------ */

const HISTORY_COMMITS: HistoryCommit[] = [
  {
    sha: DEMO_SHAS.auditorRubric,
    message: "audit: tighten the SHIP/FIX FIRST/DO NOT MERGE rubric",
    date: demoTime(60 * 6),
    url: demoRepoUrl(`commit/${DEMO_SHAS.auditorRubric}`),
  },
  {
    sha: DEMO_SHAS.builderRetry,
    message: "builder: retry once on a transient PR-open failure",
    date: demoTime(60 * 30),
    url: demoRepoUrl(`commit/${DEMO_SHAS.builderRetry}`),
  },
  {
    sha: DEMO_SHAS.scoutTuning,
    message: "scout: cap open proposals at 8, prefer novelty over volume",
    date: demoTime(60 * 54),
    url: demoRepoUrl(`commit/${DEMO_SHAS.scoutTuning}`),
  },
  {
    sha: "7be2a913c04f5d8e1a6b0c729de41f8a3c05b621",
    message: "demo: capture video, not just screenshots, on UI-heavy PRs",
    date: demoTime(60 * 24 * 3),
    url: demoRepoUrl("commit/7be2a913c04f5d8e1a6b0c729de41f8a3c05b621"),
  },
  {
    sha: "e410f7c2b8934a06d1c3e9057af426b810de5c9f",
    message: "retro: write lessons to a dated file instead of overwriting",
    date: demoTime(60 * 24 * 8),
    url: demoRepoUrl("commit/e410f7c2b8934a06d1c3e9057af426b810de5c9f"),
  },
  {
    sha: "2d6c9814e3b7f05a92c481f637ea0b5d9c1428f7",
    message: "loop: install the baseline nine-agent workflow set",
    date: demoTime(60 * 24 * 20),
    url: demoRepoUrl("commit/2d6c9814e3b7f05a92c481f637ea0b5d9c1428f7"),
  },
];

const HISTORY_FIXTURE: DemoFixture = {
  match: "/api/map/history",
  body: () => ({ commits: HISTORY_COMMITS }),
};

const HISTORY_PATCHES: Record<string, { url: string; patches: FileChange[] }> = {
  [DEMO_SHAS.auditorRubric]: {
    url: demoRepoUrl(`commit/${DEMO_SHAS.auditorRubric}`),
    patches: [
      {
        file: "claude-audit.yml",
        oldContent:
          'append_system_prompt: |\n  You are five adversarial reviewers. Post one verdict comment.\n',
        newContent:
          "append_system_prompt: |\n  You are five adversarial reviewers in sequence: correctness,\n  security, performance, tests, and product fit. Post ONE verdict\n  comment: SHIP, FIX FIRST, or DO NOT MERGE, with your reasoning.\n",
      },
    ],
  },
  [DEMO_SHAS.builderRetry]: {
    url: demoRepoUrl(`commit/${DEMO_SHAS.builderRetry}`),
    patches: [
      {
        file: "claude-builder.yml",
        oldContent: "      - uses: anthropics/claude-code-action@v1\n        with:\n",
        newContent:
          "      - uses: anthropics/claude-code-action@v1\n        with:\n          retry_on_failure: true\n",
      },
    ],
  },
  [DEMO_SHAS.scoutTuning]: {
    url: demoRepoUrl(`commit/${DEMO_SHAS.scoutTuning}`),
    patches: [
      {
        file: "claude-scout.yml",
        oldContent: "            Keep at most 5 open proposals.\n",
        newContent:
          "            Keep at most 8 open proposals — if the queue is full, only\n            file something clearly better than what's already there.\n",
      },
    ],
  },
};

const DEFAULT_PATCH: { url: string; patches: FileChange[] } = {
  url: demoRepoUrl("commit/2d6c9814e3b7f05a92c481f637ea0b5d9c1428f7"),
  patches: [
    {
      file: "claude-scout.yml",
      oldContent: null,
      newContent: RAW_YAML["claude-scout.yml"] ?? "",
    },
  ],
};

const HISTORY_DIFF_FIXTURE: DemoFixture = {
  match: /^\/api\/map\/history\/[^/]+$/,
  body: (url) => {
    const sha = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    return HISTORY_PATCHES[sha] ?? DEFAULT_PATCH;
  },
};

/* ------------------------------------------------------------------ */
/* /api/map/power                                                      */
/* ------------------------------------------------------------------ */

const POWER_FIXTURE: DemoFixture = {
  match: "/api/map/power",
  body: () => ({
    workflows: AGENTS.map((meta) => {
      const disabled = meta.id === "redraft" || meta.id === "toolinstall";
      return {
        file: meta.file,
        name: meta.label,
        state: disabled ? "disabled_manually" : "active",
        enabled: !disabled,
        isMention: meta.id === "mention",
      };
    }),
    // false: two workflows are off individually, not the whole loop.
    loopPaused: false,
    // null: the loop hasn't been master-paused, so there's no pre-pause
    // record for Resume to read.
    pauseRecord: null,
  }),
};

/* ------------------------------------------------------------------ */
/* /api/map/template + /api/map/template/drift                        */
/* ------------------------------------------------------------------ */

/** Cheap stand-in for lib/loop-template.ts's sha256-based content hash. */
function demoContentHash(content: string): string {
  let h = 2166136261;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0").repeat(2).slice(0, 16);
}

const TEMPLATE_MCP_JSON = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
`;

const TEMPLATE_BRIEF = `# Loop brief

This project is run by the same nine-agent loop as every other project on
the dashboard: Scout files ideas, you approve or send them back, Builder
opens a pull request, Auditor reviews it, Demo captures proof, and you
merge. Retro looks back weekly and Metrics writes a daily summary.

Edit this file to steer the loop's overall priorities — it's read by every
agent, not just one.
`;

const TEMPLATE_CONTRACT = `# Dashboard contract

Rules every agent workflow in this repo is expected to follow:

- Builder opens exactly one pull request per run, from a \`claude/\` branch.
- Auditor never merges — it only posts a verdict comment.
- Nothing pushes directly to \`main\`; everything goes through a PR.
- Secrets are read from repo secrets, never hard-coded.
`;

const TEMPLATE_METRICS_SCRIPT = `#!/usr/bin/env node
// Gathers yesterday's loop numbers (proposals filed, PRs opened/merged,
// audit verdicts) and writes docs/loop-metrics/<date>.md. No AI involved —
// plain reporting only.
console.log("loop-metrics: writing today's summary...");
`;

const TEMPLATE_FILE_ROWS = [
  { file: ".mcp.json", target: ".mcp.json", content: TEMPLATE_MCP_JSON },
  { file: "DASHBOARD-CONTRACT.md", target: "docs/DASHBOARD-CONTRACT.md", content: TEMPLATE_CONTRACT },
  { file: "loop-brief.md", target: "docs/loop-brief.md", content: TEMPLATE_BRIEF },
  { file: "loop-metrics.mjs", target: "scripts/loop-metrics.mjs", content: TEMPLATE_METRICS_SCRIPT },
].map((f) => ({ ...f, hash: demoContentHash(f.content) }));

/**
 * The template's agents, with the same YAML the agent drawer shows — the
 * template screen opens them in a read/edit modal, so a name alone would give
 * a public visitor an empty editor.
 */
const TEMPLATE_WORKFLOW_ROWS = AGENTS.map((a) => a.file)
  .sort()
  .map((file) => {
    const content = RAW_YAML[file] ?? `# ${file}\n`;
    return { file, content, hash: demoContentHash(content) };
  });

const TEMPLATE_FIXTURE: DemoFixture = {
  match: "/api/map/template",
  body: () => ({
    exists: true,
    workflows: TEMPLATE_WORKFLOW_ROWS,
    files: TEMPLATE_FILE_ROWS,
  }),
};

const TEMPLATE_DRIFT_FIXTURE: DemoFixture = {
  match: "/api/map/template/drift",
  body: (url) => {
    const projectKey = url.searchParams.get("project") ?? DEMO_DEFAULT_PROJECT.key;
    const isTidepool = projectKey === TIDEPOOL.key;
    const projectLabel = isTidepool ? TIDEPOOL.label : DEMO_DEFAULT_PROJECT.label;

    // Aurora Notes is fully in sync; Tidepool (newer, less looked-after) has
    // one file that's drifted and one it hasn't picked up yet — gives the
    // drift screen something to actually show.
    if (!isTidepool) {
      return {
        project: projectKey,
        projectLabel,
        inSync: true,
        templateEmpty: false,
        counts: {
          identical: AGENTS.length,
          "repo-behind-or-diverged": 0,
          "missing-in-repo": 0,
          "extra-in-repo": 0,
        },
        files: AGENTS.map((a) => ({ file: a.file, status: "identical" as const, diff: "" })),
      };
    }

    const behindDiff =
      "--- template/claude-audit.yml\n+++ repo/claude-audit.yml\n@@ -1,3 +1,3 @@\n name: Auditor\n on:\n-  pull_request:\n+  pull_request_target:\n";
    const missingDiff =
      "--- template/claude-retro.yml\n+++ repo/claude-retro.yml (absent)\n@@ -1,1 +1,0 @@\n-name: Retro\n";

    return {
      project: projectKey,
      projectLabel,
      inSync: false,
      templateEmpty: false,
      counts: {
        identical: AGENTS.length - 2,
        "repo-behind-or-diverged": 1,
        "missing-in-repo": 1,
        "extra-in-repo": 0,
      },
      files: [
        ...AGENTS.filter((a) => a.id !== "audit" && a.id !== "retro").map((a) => ({
          file: a.file,
          status: "identical" as const,
          diff: "",
        })),
        { file: "claude-audit.yml", status: "repo-behind-or-diverged" as const, diff: behindDiff },
        { file: "claude-retro.yml", status: "missing-in-repo" as const, diff: missingDiff },
      ],
    };
  },
};

/* ------------------------------------------------------------------ */
/* /api/map/projects/checklist                                         */
/* ------------------------------------------------------------------ */

const CHECKLIST_FIXTURE: DemoFixture = {
  match: "/api/map/projects/checklist",
  body: (url) => {
    const repo =
      url.searchParams.get("project") === TIDEPOOL.key
        ? `${DEMO_OWNER}/${TIDEPOOL.repo}`
        : `${DEMO_OWNER}/${DEMO_DEFAULT_PROJECT.repo}`;
    return {
      // true: the demo's fictional secret is present, same as a real fully
      // set-up project — nothing left to nudge the visitor to fix.
      secret: true,
      secretHelp: `Secrets can't be copied between repos. In a terminal: gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${repo} — or paste the token by hand on GitHub under Settings → Secrets and variables → Actions.`,
      app: {
        status: "unknown",
        note:
          "The dashboard can't check GitHub App installs with its token. Make sure the Claude GitHub app covers this repo — it takes one minute — and the first agent run will prove it either way.",
        url: "https://github.com/apps/claude",
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* /api/launch/status                                                  */
/* ------------------------------------------------------------------ */

/**
 * The real route is LOCAL-ONLY (it 404s unless LOOP_DASHBOARD_LOCAL_MODE is
 * set) because it reads the owner's own Mac. A public visitor has no local
 * machine for the demo to probe, so the honest answer is simply "no
 * launcher configured here" — not a fabricated running product.
 */
const LAUNCH_STATUS_FIXTURE: DemoFixture = {
  match: "/api/launch/status",
  body: () => ({
    configured: false,
    running: false,
    url: null,
    kind: null,
    analyzedAt: null,
    notes: null,
  }),
};

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

export const MAP_FIXTURES: DemoFixture[] = [
  PROJECTS_FIXTURE,
  STATUS_FIXTURE,
  AGENT_DETAIL_FIXTURE,
  HISTORY_FIXTURE,
  HISTORY_DIFF_FIXTURE,
  POWER_FIXTURE,
  TEMPLATE_FIXTURE,
  TEMPLATE_DRIFT_FIXTURE,
  CHECKLIST_FIXTURE,
  LAUNCH_STATUS_FIXTURE,
];
