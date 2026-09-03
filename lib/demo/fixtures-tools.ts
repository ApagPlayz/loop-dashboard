/**
 * Demo fixtures for the Tools and Testing sections.
 *
 * Covers (GET only):
 *   /api/tools/catalog            /api/testing/dispatch-options
 *   /api/tools/activity           /api/testing/instructions
 *   /api/tools/needs-you          /api/testing/runs
 *   /api/tools/install  (GET)     /api/testing/test-suite
 *   /api/tools/fit/repos          /api/testing/metrics-compare
 *                                 /api/testing/commit-diff
 *
 * NOTHING REAL may go in this file: no private repo names, no real issue/PR
 * text, no owner handle beyond `loop-demo`, no filesystem paths, no tokens, no
 * CI log text or stack traces. The only real-world names allowed are the
 * well-known open-source developer tools listed in the catalog below — their
 * names and one-line descriptions are public information, not anything of
 * the owner's. Every other id, run, commit, issue and PR here is invented for
 * the fictional "Aurora Notes" note-taking app that the demo loop maintains.
 *
 * Response shapes are copied field-for-field from the real route handlers in
 * app/api/tools/** and app/api/testing/** (read in full while writing this),
 * and typed against the real exported types wherever one exists so `tsc`
 * checks the shape.
 */

import type { DemoFixture } from "@/lib/demo/types";
import type { CatalogEntry } from "@/lib/tool-catalog";
import type { ActionIssue, ToolPr } from "@/lib/tools";
import type {
  RunSummary,
  JobStep,
  Option,
  InstructionCommit,
  FilePatch,
  BeforeAfter,
} from "@/lib/testing";
import {
  DEMO_PROJECTS,
  DEMO_SHAS,
  DEMO_IDEA_NUMBERS,
  DEMO_PR_NUMBERS,
  DEMO_RUN_IDS,
  DEMO_CAPTURED_AT,
  demoTime,
  demoRepoUrl,
} from "@/lib/demo/world";

const HOUR = 60;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------ */
/* 1. Tool catalog — real, well-known open-source tools/MCP servers    */
/* ------------------------------------------------------------------ */

const CATALOG_ENTRIES: CatalogEntry[] = [
  {
    id: "mcp-playwright",
    name: "Playwright",
    type: "mcp",
    status: "reviewed",
    url: "https://github.com/microsoft/playwright-mcp",
    description:
      "Drives a real browser so Claude can click through Aurora Notes and see what changed, not just read the diff.",
    goodFor: [
      "Verifying a UI change actually works before it ships",
      "Capturing screenshots for the Demo agent",
      "Reproducing a bug a user described",
    ],
    features: ["Real Chromium/Firefox/WebKit sessions", "Screenshots and traces", "Accessibility snapshots"],
    requirements: "No API key — runs a local headless browser",
    popularity: "Maintained by Microsoft; the most-used browser-automation MCP server",
    lastVerified: "2026-08-24",
    trustTier: "official",
    rankScore: 0.91,
    stale: false,
    categories: ["Browser automation & testing"],
    safetyFlags: [],
    source: "seed",
    recommended: true,
  },
  {
    id: "mcp-ripgrep",
    name: "Ripgrep",
    type: "mcp",
    status: "reviewed",
    url: "https://github.com/BurntSushi/ripgrep",
    description: "Wraps the `rg` search tool so agents can grep a large codebase in milliseconds instead of minutes.",
    goodFor: [
      "Finding every call site before a refactor",
      "Searching across the whole notes-sync codebase fast",
      "Auditing where a config value is actually read",
    ],
    features: [".gitignore-aware search", "Regex and literal modes", "Orders of magnitude faster than grep -r"],
    requirements: "No setup — works out of the box",
    popularity: "One of the most widely-installed CLI search tools in any dev toolchain",
    lastVerified: "2026-08-24",
    trustTier: "official",
    rankScore: 0.88,
    stale: false,
    categories: ["Code search"],
    safetyFlags: [],
    source: "seed",
    recommended: true,
  },
  {
    id: "mcp-postgres",
    name: "Postgres",
    type: "mcp",
    status: "reviewed",
    url: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres",
    description: "Lets an agent run read-only SQL against a Postgres database to check what's actually stored.",
    goodFor: [
      "Confirming a migration landed the way it was meant to",
      "Debugging a sync bug by reading the notes table directly",
      "Checking row counts before/after a bulk change",
    ],
    features: ["Read-only query execution", "Schema introspection", "Works with any standard Postgres connection string"],
    requirements: "A database connection string with read access",
    popularity: "Official reference server; the default pick for Postgres-backed apps",
    lastVerified: "2026-08-20",
    trustTier: "official",
    rankScore: 0.83,
    stale: false,
    categories: ["Databases"],
    safetyFlags: ["Needs a database connection string."],
    source: "seed",
    recommended: false,
  },
  {
    id: "mcp-github",
    name: "GitHub",
    type: "mcp",
    status: "reviewed",
    url: "https://github.com/github/github-mcp-server",
    description: "Gives an agent direct GitHub API access — issues, PRs, checks — beyond what the git CLI can do.",
    goodFor: [
      "Cross-referencing an issue from inside a PR review",
      "Checking CI status on a branch before merging",
      "Looking up who last touched a file and why",
    ],
    features: ["Issues, PRs, and review threads", "Check-run status", "Search across the whole org"],
    requirements: "A GitHub token scoped to the repos it should see",
    popularity: "Official server maintained by GitHub; broad adoption across Claude Code setups",
    lastVerified: "2026-08-24",
    trustTier: "official",
    rankScore: 0.87,
    stale: false,
    categories: ["Source control"],
    safetyFlags: ["Needs a GitHub token with repo access."],
    source: "seed",
    recommended: false,
  },
  {
    id: "mcp-filesystem",
    name: "Filesystem",
    type: "mcp",
    status: "reviewed",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    description: "Lets an agent read, write, and organize files inside folders you approve.",
    goodFor: [
      "Reading and editing local project files",
      "Organizing generated assets and docs",
      "Searching for a file by name or content",
    ],
    features: ["Read/write/move files", "Directory listing and search", "Access limited to folders you allow"],
    requirements: "No API key — just the folders it's allowed to touch",
    popularity: "One of the original official reference servers, bundled with most MCP setups",
    lastVerified: "2026-08-15",
    trustTier: "official",
    rankScore: 0.85,
    stale: false,
    categories: ["Files & storage"],
    safetyFlags: ["Can change or delete files in the folders it's given."],
    source: "seed",
    recommended: false,
  },
  {
    id: "mcp-memory",
    name: "Memory",
    type: "mcp",
    status: "reviewed",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    description: "Gives an agent a simple persistent notebook so it can remember facts between runs.",
    goodFor: [
      "Remembering a decision across separate agent runs",
      "Building up a running knowledge graph of the codebase",
      "Avoiding re-explaining the same context every time",
    ],
    features: ["Simple knowledge-graph storage", "Persists between sessions", "Local file-based storage"],
    requirements: "No setup — works out of the box",
    popularity: "Official reference server, commonly paired with long-running agent setups",
    lastVerified: "2026-08-15",
    trustTier: "official",
    rankScore: 0.79,
    stale: false,
    categories: ["Other"],
    safetyFlags: [],
    source: "seed",
    recommended: false,
  },
  {
    id: "mcp-sequential-thinking",
    name: "Sequential Thinking",
    type: "mcp",
    status: "reviewed",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    description: "Helps an agent break a hard problem into clear, revisable steps before it starts changing code.",
    goodFor: [
      "Planning a multi-file refactor before touching anything",
      "Working through a tricky sync-conflict bug",
      "Reducing rushed, half-finished changes",
    ],
    features: ["Structured step-by-step reasoning", "Revisable thought steps", "No external data needed"],
    requirements: "No setup — works out of the box",
    popularity: "Official reference server, popular for planning-heavy tasks",
    lastVerified: "2026-08-15",
    trustTier: "official",
    rankScore: 0.74,
    stale: false,
    categories: ["AI & data"],
    safetyFlags: [],
    source: "seed",
    recommended: false,
  },
  {
    id: "mcp-brave-search",
    name: "Brave Search",
    type: "mcp",
    status: "reviewed",
    url: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/brave-search",
    description: "Web search an agent can call directly, without going through a browser.",
    goodFor: [
      "Checking how a competing notes app solved the same problem",
      "Looking up a library's current API before using it",
      "Fact-checking a claim in a drafted proposal",
    ],
    features: ["Web + news search", "Structured result snippets", "No browser needed"],
    requirements: "A Brave Search API key",
    popularity: "Verified vendor server; a common default for agent web search",
    lastVerified: "2026-08-18",
    trustTier: "verified",
    rankScore: 0.7,
    stale: false,
    categories: ["Web search & scraping"],
    safetyFlags: ["Needs an API key.", "Can spend money on search queries."],
    source: "seed",
    recommended: false,
  },
  {
    id: "mcp-sentry",
    name: "Sentry",
    type: "mcp",
    status: "reviewed",
    url: "https://github.com/getsentry/sentry-mcp",
    description: "Lets an agent read error reports and stack traces straight from Sentry instead of guessing.",
    goodFor: [
      "Triaging a spike in sync errors right after a release",
      "Pulling the exact stack trace for a bug report",
      "Checking whether a fix actually made an error stop firing",
    ],
    features: ["Issue and event lookup", "Release health", "Assign/resolve issues"],
    requirements: "A Sentry auth token for the project",
    popularity: "Official server from Sentry; widely used for error-driven debugging",
    lastVerified: "2026-08-22",
    trustTier: "verified",
    rankScore: 0.68,
    stale: false,
    categories: ["Monitoring & errors"],
    safetyFlags: ["Needs a Sentry auth token."],
    source: "seed",
    recommended: false,
  },
  {
    id: "skill-pdf",
    name: "PDF",
    type: "skill",
    status: "reviewed",
    url: "https://github.com/anthropics/skills/tree/main/pdf",
    description: "Reads, fills in, and creates PDF files — useful for a note app's \"export to PDF\" path.",
    goodFor: [
      "Building the export-to-PDF feature",
      "Reading a PDF a user attached to a note",
      "Filling in a PDF form programmatically",
    ],
    features: ["Text and form-field extraction", "PDF generation", "Works with scanned and native PDFs"],
    requirements: "No setup — works out of the box",
    popularity: "Official Anthropic skill, part of the public skills cookbook",
    lastVerified: "2026-08-10",
    trustTier: "official",
    rankScore: 0.66,
    stale: false,
    categories: ["Documents"],
    safetyFlags: [],
    source: "seed",
    recommended: false,
  },
];

const CATALOG_REQUESTED_IDS = ["mcp-sentry", "mcp-brave-search"];

/* ------------------------------------------------------------------ */
/* 2. Install activity                                                 */
/* ------------------------------------------------------------------ */

const INSTALL_RUNS: RunSummary[] = [
  {
    id: 30190441,
    name: "claude-tool-install",
    workflowFile: "claude-tool-install.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(69),
    updatedAt: demoTime(64),
    runStartedAt: demoTime(69),
    htmlUrl: demoRepoUrl("actions/runs/30190441"),
    event: "repository_dispatch",
    displayName: "Tool installer",
  },
  {
    id: 30186210,
    name: "claude-tool-install",
    workflowFile: "claude-tool-install.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(40),
    updatedAt: demoTime(35),
    runStartedAt: demoTime(40),
    htmlUrl: demoRepoUrl("actions/runs/30186210"),
    event: "repository_dispatch",
    displayName: "Tool installer",
  },
  {
    id: 30171004,
    name: "claude-tool-install",
    workflowFile: "claude-tool-install.yml",
    status: "completed",
    conclusion: "failure",
    createdAt: demoTime(3 * DAY),
    updatedAt: demoTime(3 * DAY - 5),
    runStartedAt: demoTime(3 * DAY),
    htmlUrl: demoRepoUrl("actions/runs/30171004"),
    event: "repository_dispatch",
    displayName: "Tool installer",
  },
];

const INSTALL_PRS: ToolPr[] = [
  {
    number: 219,
    title: "Install Sentry MCP server for the Auditor",
    branch: "claude/tool-install-sentry-mcp",
    htmlUrl: demoRepoUrl("pull/219"),
    createdAt: demoTime(69),
  },
  {
    number: 221,
    title: "Install Brave Search MCP server for Scout",
    branch: "claude/tool-install-brave-search",
    htmlUrl: demoRepoUrl("pull/221"),
    createdAt: demoTime(40),
  },
];

/* ------------------------------------------------------------------ */
/* 3. Needs you                                                        */
/* ------------------------------------------------------------------ */

const NEEDS_YOU_ISSUES: ActionIssue[] = [
  {
    number: 220,
    title: "🔑 Action needed: add a SENTRY_AUTH_TOKEN secret",
    body:
      "The tool-install run opened **#219**, wiring the Sentry MCP server into the Auditor. It needs a `SENTRY_AUTH_TOKEN` " +
      "repo secret scoped to the Aurora Notes Sentry project before the Auditor can actually use it.\n\n" +
      "1. Create a Sentry internal integration token with `event:read` and `project:read`\n" +
      "2. Add it as a repository secret named `SENTRY_AUTH_TOKEN`\n" +
      "3. Comment below (or just close this) once it's in — the next Auditor run will pick it up automatically",
    htmlUrl: demoRepoUrl("issues/220"),
    createdAt: demoTime(68),
  },
  {
    number: 222,
    title: "🔑 Action needed: add a BRAVE_API_KEY secret",
    body:
      "**#221** installs the Brave Search MCP server for Scout so it can check how similar note apps solved a problem " +
      "before filing a proposal. It needs a `BRAVE_API_KEY` repo secret — the free tier is plenty for how often Scout runs.\n\n" +
      "Add the key as a repository secret named `BRAVE_API_KEY` and Scout will start using it on its next scheduled run.",
    htmlUrl: demoRepoUrl("issues/222"),
    createdAt: demoTime(39),
  },
];

/* ------------------------------------------------------------------ */
/* 4. tools/fit/repos                                                  */
/* ------------------------------------------------------------------ */

type FitRepoOption = { owner: string; repo: string; label: string; fullName: string };

const FIT_REPOS: FitRepoOption[] = DEMO_PROJECTS.map((p) => ({
  owner: p.owner,
  repo: p.repo,
  label: p.label,
  fullName: `${p.owner}/${p.repo}`,
}));

/* ------------------------------------------------------------------ */
/* 5. testing/dispatch-options                                         */
/* ------------------------------------------------------------------ */

const REDRAFT_ISSUE_OPTIONS: Option[] = [
  {
    value: String(DEMO_IDEA_NUMBERS.offlineQueue),
    label: `#${DEMO_IDEA_NUMBERS.offlineQueue} — Add an offline write queue for flaky connections`,
  },
  {
    value: String(DEMO_IDEA_NUMBERS.sharedNotebooks),
    label: `#${DEMO_IDEA_NUMBERS.sharedNotebooks} — Shared notebooks between two accounts`,
  },
  {
    value: String(DEMO_IDEA_NUMBERS.exportMarkdown),
    label: `#${DEMO_IDEA_NUMBERS.exportMarkdown} — Export a notebook to Markdown`,
  },
];

const CLAUDE_PR_OPTIONS: Option[] = [
  {
    value: String(DEMO_PR_NUMBERS.offlineQueue),
    label: `#${DEMO_PR_NUMBERS.offlineQueue} — Add an offline write queue for flaky connections`,
  },
  {
    value: String(DEMO_PR_NUMBERS.searchRanking),
    label: `#${DEMO_PR_NUMBERS.searchRanking} — Improve search ranking for recently edited notes`,
  },
];

const INSTALLED_WORKFLOW_FILES = [
  "claude-scout.yml",
  "claude-builder.yml",
  "claude-audit.yml",
  "claude-mention.yml",
  "claude-retro.yml",
  "claude-redraft.yml",
  "claude-demo.yml",
  "claude-tool-install.yml",
  "loop-metrics.yml",
  "repo-tests.yml",
];

/* ------------------------------------------------------------------ */
/* 6. testing/instructions + testing/commit-diff                       */
/* ------------------------------------------------------------------ */

/** Older commits (before the ones tracked in world.ts) — local to this file. */
const OLDER_SHAS = {
  scoutCapability: "a1e4c8d2f6b91073c5e0a4d8f2b6917e3c0a5d41",
  builderRedraftWiring: "5b7f0913c2a4e8d6b1f30a9c7e2d5b48160f7a93",
  auditorSizeRule: "e094a7c3b2f18d6057a3c9e1b4d80f26a7c53e12",
} as const;

const INSTRUCTION_GROUPS: { file: string; name: string; commits: InstructionCommit[] }[] = [
  {
    file: "claude-scout.yml",
    name: "Scout",
    commits: [
      {
        sha: DEMO_SHAS.scoutTuning,
        message: "dashboard: edit Scout instructions — prefer small, single-file proposals",
        author: "loop-demo",
        date: demoTime(10 * DAY),
        htmlUrl: demoRepoUrl(`commit/${DEMO_SHAS.scoutTuning}`),
        isDashboardEdit: true,
      },
      {
        sha: OLDER_SHAS.scoutCapability,
        message: "Add a capability check so Scout skips ideas the loop can't build yet",
        author: "loop-demo",
        date: demoTime(24 * DAY),
        htmlUrl: demoRepoUrl(`commit/${OLDER_SHAS.scoutCapability}`),
        isDashboardEdit: false,
      },
    ],
  },
  {
    file: "claude-builder.yml",
    name: "Builder",
    commits: [
      {
        sha: DEMO_SHAS.builderRetry,
        message: "dashboard: edit Builder instructions — retry once before giving up on a flaky test",
        author: "loop-demo",
        date: demoTime(7 * DAY),
        htmlUrl: demoRepoUrl(`commit/${DEMO_SHAS.builderRetry}`),
        isDashboardEdit: true,
      },
      {
        sha: OLDER_SHAS.builderRedraftWiring,
        message: "Let Builder pick up a redrafted proposal automatically",
        author: "loop-demo",
        date: demoTime(19 * DAY),
        htmlUrl: demoRepoUrl(`commit/${OLDER_SHAS.builderRedraftWiring}`),
        isDashboardEdit: false,
      },
    ],
  },
  {
    file: "claude-audit.yml",
    name: "Auditor",
    commits: [
      {
        sha: DEMO_SHAS.auditorRubric,
        message: "dashboard: edit Auditor instructions — sharpen the rubric for offline-queue edge cases",
        author: "loop-demo",
        date: demoTime(3 * DAY),
        htmlUrl: demoRepoUrl(`commit/${DEMO_SHAS.auditorRubric}`),
        isDashboardEdit: true,
      },
      {
        sha: OLDER_SHAS.auditorSizeRule,
        message: "Add a PR-size rule to the Auditor's rubric",
        author: "loop-demo",
        date: demoTime(15 * DAY),
        htmlUrl: demoRepoUrl(`commit/${OLDER_SHAS.auditorSizeRule}`),
        isDashboardEdit: false,
      },
    ],
  },
];

type CommitDiffBody = { message: string; files: FilePatch[] };

const COMMIT_DIFFS: Record<string, CommitDiffBody> = {
  [DEMO_SHAS.scoutTuning]: {
    message: "dashboard: edit Scout instructions — prefer small, single-file proposals",
    files: [
      {
        filename: ".github/workflows/claude-scout.yml",
        patch:
          "@@ -18,7 +18,7 @@\n" +
          '           claude -p "You are Scout for Aurora Notes. Look for the next best\n' +
          '-          proposal, and prefer changes that touch many files if they show real user impact."\n' +
          '+          proposal, and prefer small, single-file proposals unless a change genuinely needs to span files."\n' +
          '           --allowedTools "Read,Grep,Glob,WebSearch"',
        additions: 1,
        deletions: 1,
      },
    ],
  },
  [DEMO_SHAS.builderRetry]: {
    message: "dashboard: edit Builder instructions — retry once before giving up on a flaky test",
    files: [
      {
        filename: ".github/workflows/claude-builder.yml",
        patch:
          "@@ -24,6 +24,8 @@\n" +
          "           If the test suite fails, read the failure carefully before deciding what to do.\n" +
          "+          If a failure looks flaky (timing, network, unrelated to your change), retry the\n" +
          "+          suite once before giving up on the proposal.\n" +
          '           --allowedTools "Read,Edit,Bash,Grep,Glob"',
        additions: 2,
        deletions: 0,
      },
    ],
  },
  [DEMO_SHAS.auditorRubric]: {
    message: "dashboard: edit Auditor instructions — sharpen the rubric for offline-queue edge cases",
    files: [
      {
        filename: ".github/workflows/claude-audit.yml",
        patch:
          "@@ -15,6 +15,8 @@\n" +
          "           Check that the PR does what the proposal asked, is well-tested, and is\n" +
          "           no larger than it needs to be.\n" +
          "+          For anything touching the offline write queue, confirm retried writes\n" +
          "+          can't be applied twice if the same note was edited on two devices.\n" +
          '           --allowedTools "Read,Grep,Glob"',
        additions: 2,
        deletions: 0,
      },
    ],
  },
  [OLDER_SHAS.scoutCapability]: {
    message: "Add a capability check so Scout skips ideas the loop can't build yet",
    files: [
      {
        filename: ".github/workflows/claude-scout.yml",
        patch:
          "@@ -9,6 +9,8 @@\n" +
          "         claude -p \"Before filing a proposal, check the repo's current capabilities\n" +
          "+        so you don't propose something the loop has no way to build yet (e.g. a\n" +
          "+        mobile app, when this repo only ships a web client).\n" +
          '         --allowedTools "Read,Grep,Glob"',
        additions: 2,
        deletions: 0,
      },
    ],
  },
  [OLDER_SHAS.builderRedraftWiring]: {
    message: "Let Builder pick up a redrafted proposal automatically",
    files: [
      {
        filename: ".github/workflows/claude-builder.yml",
        patch:
          "@@ -6,6 +6,7 @@\n" +
          "         claude -p \"Pick the best open, approved proposal. If a proposal was\n" +
          "+        recently redrafted, prefer it over an older one with a similar score.\n" +
          '         --allowedTools "Read,Edit,Bash,Grep,Glob"',
        additions: 1,
        deletions: 0,
      },
    ],
  },
  [OLDER_SHAS.auditorSizeRule]: {
    message: "Add a PR-size rule to the Auditor's rubric",
    files: [
      {
        filename: ".github/workflows/claude-audit.yml",
        patch:
          "@@ -11,6 +11,8 @@\n" +
          "         claude -p \"Review this PR against the proposal it came from.\n" +
          "+        Flag anything over roughly 400 changed lines for a second look — big\n" +
          "+        proposals are where the loop's mistakes tend to hide.\n" +
          '         --allowedTools "Read,Grep,Glob"',
        additions: 2,
        deletions: 0,
      },
    ],
  },
};

const DEFAULT_COMMIT_DIFF: CommitDiffBody = COMMIT_DIFFS[DEMO_SHAS.scoutTuning];

/* ------------------------------------------------------------------ */
/* 7. testing/runs — general recent-runs pool                          */
/* ------------------------------------------------------------------ */

const GENERAL_RUNS: RunSummary[] = [
  {
    id: DEMO_RUN_IDS.scout,
    name: "Scout",
    workflowFile: "claude-scout.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(45),
    updatedAt: demoTime(38),
    runStartedAt: demoTime(45),
    htmlUrl: demoRepoUrl(`actions/runs/${DEMO_RUN_IDS.scout}`),
    event: "schedule",
    displayName: "Scout",
  },
  {
    id: DEMO_RUN_IDS.builder,
    name: "Builder",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(2 * HOUR + 10),
    updatedAt: demoTime(2 * HOUR),
    runStartedAt: demoTime(2 * HOUR + 10),
    htmlUrl: demoRepoUrl(`actions/runs/${DEMO_RUN_IDS.builder}`),
    event: "schedule",
    displayName: "Builder",
  },
  {
    id: DEMO_RUN_IDS.auditor,
    name: "Auditor",
    workflowFile: "claude-audit.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(2 * HOUR + 5),
    updatedAt: demoTime(2 * HOUR - 5),
    runStartedAt: demoTime(2 * HOUR + 5),
    htmlUrl: demoRepoUrl(`actions/runs/${DEMO_RUN_IDS.auditor}`),
    event: "pull_request",
    displayName: "Auditor",
  },
  {
    id: DEMO_RUN_IDS.demo,
    name: "Capture demo evidence",
    workflowFile: "claude-demo.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(2 * HOUR),
    updatedAt: demoTime(2 * HOUR - 8),
    runStartedAt: demoTime(2 * HOUR),
    htmlUrl: demoRepoUrl(`actions/runs/${DEMO_RUN_IDS.demo}`),
    event: "workflow_dispatch",
    displayName: "Capture demo evidence",
  },
  {
    id: DEMO_RUN_IDS.tests,
    name: "Test suite",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(20),
    updatedAt: demoTime(14),
    runStartedAt: demoTime(20),
    htmlUrl: demoRepoUrl(`actions/runs/${DEMO_RUN_IDS.tests}`),
    event: "workflow_dispatch",
    displayName: "Test suite",
  },
  {
    id: 18420990,
    name: "Retro",
    workflowFile: "claude-retro.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(2 * DAY),
    updatedAt: demoTime(2 * DAY - 12),
    runStartedAt: demoTime(2 * DAY),
    htmlUrl: demoRepoUrl("actions/runs/18420990"),
    event: "schedule",
    displayName: "Retro",
  },
  {
    id: 18420870,
    name: "Refresh metrics",
    workflowFile: "loop-metrics.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(DAY),
    updatedAt: demoTime(DAY - 3),
    runStartedAt: demoTime(DAY),
    htmlUrl: demoRepoUrl("actions/runs/18420870"),
    event: "schedule",
    displayName: "Refresh metrics",
  },
  {
    id: 18420711,
    name: "Scout",
    workflowFile: "claude-scout.yml",
    status: "completed",
    conclusion: "success",
    createdAt: demoTime(DAY + 45),
    updatedAt: demoTime(DAY + 38),
    runStartedAt: demoTime(DAY + 45),
    htmlUrl: demoRepoUrl("actions/runs/18420711"),
    event: "schedule",
    displayName: "Scout",
  },
  {
    id: 18420602,
    name: "Test suite",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "failure",
    createdAt: demoTime(DAY + 90),
    updatedAt: demoTime(DAY + 82),
    runStartedAt: demoTime(DAY + 90),
    htmlUrl: demoRepoUrl("actions/runs/18420602"),
    event: "push",
    displayName: "Test suite",
  },
  {
    id: 18420533,
    name: "Builder",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "failure",
    createdAt: demoTime(2 * DAY + 30),
    updatedAt: demoTime(2 * DAY + 22),
    runStartedAt: demoTime(2 * DAY + 30),
    htmlUrl: demoRepoUrl("actions/runs/18420533"),
    event: "schedule",
    displayName: "Builder",
  },
];

/* ------------------------------------------------------------------ */
/* 8. testing/test-suite                                               */
/* ------------------------------------------------------------------ */

const TEST_SUITE_HISTORY_IDS = [
  18421410, 18421380, 18421350, 18421320, 18421290, 18421260, 18421230, 18421200, 18421170, 18421140,
];

const TEST_SUITE_HISTORY: RunSummary[] = TEST_SUITE_HISTORY_IDS.map((id, i) => {
  // Two failures scattered through the history; everything else passes.
  const conclusion = i === 3 || i === 7 ? "failure" : "success";
  const minutesBefore = 20 + i * 95;
  return {
    id,
    name: "Test suite",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion,
    createdAt: demoTime(minutesBefore),
    updatedAt: demoTime(Math.max(0, minutesBefore - 6)),
    runStartedAt: demoTime(minutesBefore),
    htmlUrl: demoRepoUrl(`actions/runs/${id}`),
    event: i === 0 ? "workflow_dispatch" : "schedule",
    displayName: "Test suite",
  };
});

const TEST_SUITE_STEPS: JobStep[] = [
  { name: "Install dependencies (Node)", status: "completed", conclusion: "success", number: 1 },
  { name: "Lint", status: "completed", conclusion: "success", number: 2 },
  { name: "Test (Node)", status: "completed", conclusion: "success", number: 3 },
  { name: "Build", status: "completed", conclusion: "success", number: 4 },
  { name: "Install dependencies (Python)", status: "completed", conclusion: "skipped", number: 5 },
  { name: "Test (Python)", status: "completed", conclusion: "skipped", number: 6 },
];

/* ------------------------------------------------------------------ */
/* 9. testing/metrics-compare                                          */
/* ------------------------------------------------------------------ */

const METRICS_BEFORE_AFTER: Omit<BeforeAfter, "cutoff"> = {
  before: {
    count: 6,
    merge_rate_pct: 61.4,
    prs_merged: 4.2,
    prs_rejected: 2.1,
    median_pr_size_lines: 184,
    proposal_approval_rate_pct: 58,
  },
  after: {
    count: 7,
    merge_rate_pct: 78.9,
    prs_merged: 5.6,
    prs_rejected: 0.9,
    median_pr_size_lines: 96,
    proposal_approval_rate_pct: 74.3,
  },
  thin: false,
};

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

export const TOOLS_FIXTURES: DemoFixture[] = [
  {
    match: "/api/tools/catalog",
    body: () => ({
      generatedAt: DEMO_CAPTURED_AT,
      entries: CATALOG_ENTRIES,
      requestedIds: CATALOG_REQUESTED_IDS,
    }),
  },
  {
    match: "/api/tools/activity",
    body: () => ({
      runs: INSTALL_RUNS,
      prs: INSTALL_PRS,
    }),
  },
  {
    match: "/api/tools/needs-you",
    body: () => ({
      issues: NEEDS_YOU_ISSUES,
    }),
  },
  {
    // GET only — the install POST is never exposed to an anonymous visitor.
    match: "/api/tools/install",
    methods: ["GET"],
    body: () => ({ available: true }),
  },
  {
    match: "/api/tools/fit/repos",
    body: () => ({
      projects: FIT_REPOS,
    }),
  },
  {
    match: "/api/testing/dispatch-options",
    body: () => ({
      redraftIssues: REDRAFT_ISSUE_OPTIONS,
      claudePrs: CLAUDE_PR_OPTIONS,
      installed: INSTALLED_WORKFLOW_FILES,
    }),
  },
  {
    match: "/api/testing/instructions",
    body: () => ({
      groups: INSTRUCTION_GROUPS,
    }),
  },
  {
    match: "/api/testing/runs",
    body: (url: URL) => {
      const file = url.searchParams.get("file");
      const perPageRaw = Number(url.searchParams.get("per_page") ?? "15");
      const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0 ? perPageRaw : 15;
      const runs = (file ? GENERAL_RUNS.filter((r) => r.workflowFile === file) : GENERAL_RUNS).slice(0, perPage);
      return { runs };
    },
  },
  {
    match: "/api/testing/test-suite",
    body: () => ({
      latest: TEST_SUITE_HISTORY[0],
      history: TEST_SUITE_HISTORY,
      steps: TEST_SUITE_STEPS,
    }),
  },
  {
    match: "/api/testing/metrics-compare",
    body: (url: URL) => {
      const cutoff = url.searchParams.get("date") ?? demoTime(10 * DAY);
      return { ...METRICS_BEFORE_AFTER, cutoff };
    },
  },
  {
    match: "/api/testing/commit-diff",
    body: (url: URL) => {
      const sha = url.searchParams.get("sha");
      return (sha && COMMIT_DIFFS[sha]) || DEFAULT_COMMIT_DIFF;
    },
  },
];
