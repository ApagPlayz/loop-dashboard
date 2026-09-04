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
 * ## All real
 *
 * Runs, run ids, job steps, commit shas, patches, issues and pull requests are
 * from github.com/ApagPlayz/content-generation-platform as of 4 September 2026.
 * The catalog rows are copied out of this repo's own
 * `config/tool-catalog.json`. The before/after numbers on the metrics-compare
 * panel are computed from that repo's committed
 * `metrics/loop-metrics.json` — see the note above them for the cutoff and
 * what it means.
 *
 * Nothing here is invented, and nothing was reworded. See lib/demo/world.ts.
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
import { DEMO_PROJECTS, DEMO_CAPTURED_AT } from "@/lib/demo/world";

/* ------------------------------------------------------------------ */
/* 1. Tool catalog — rows from this repo's own config/tool-catalog.json */
/* ------------------------------------------------------------------ */

const CATALOG_ENTRIES: CatalogEntry[] = [
  {
    "id": "mcp-playwright",
    "name": "Playwright",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/microsoft/playwright-mcp",
    "description": "Lets Claude control a real web browser — click, type, navigate — to test or use websites.",
    "goodFor": [
      "Automated browser testing",
      "Filling out web forms",
      "Scraping or checking live website content"
    ],
    "features": [
      "Uses the accessibility tree, not screenshots",
      "Click, type, navigate, take screenshots",
      "Works with Chrome, Firefox, and WebKit"
    ],
    "requirements": "No account needed — installs and runs locally",
    "popularity": "Official Microsoft server, 30k+ GitHub stars",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Browser & automation"
    ],
    "safetyFlags": [],
    "source": "seed",
    "recommended": true
  },
  {
    "id": "mcp-github",
    "name": "GitHub",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/github/github-mcp-server",
    "description": "Lets Claude read and manage your GitHub repos — issues, pull requests, code, and Actions.",
    "goodFor": [
      "Managing issues and pull requests",
      "Reviewing code and CI failures",
      "Automating repo housekeeping"
    ],
    "features": [
      "Repo and code search/browsing",
      "Issue and PR creation/management",
      "GitHub Actions and security-alert visibility"
    ],
    "requirements": "Needs a GitHub account (personal access token or OAuth)",
    "popularity": "Official GitHub server (moved from the MCP reference repo), ~28k GitHub stars, actively maintained",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Dev tools"
    ],
    "safetyFlags": [
      "Needs an API key or account login — you'll be asked for it."
    ],
    "source": "seed",
    "recommended": false
  },
  {
    "id": "mcp-filesystem",
    "name": "Filesystem",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    "description": "Lets Claude read, write, and organize files on your computer inside folders you approve.",
    "goodFor": [
      "Reading and editing local project files",
      "Organizing documents and folders",
      "Searching for files by name or content"
    ],
    "features": [
      "Read/write/move files",
      "Directory listing and search",
      "Access limited to folders you allow"
    ],
    "requirements": "No API key needed — just tell it which folders it can access",
    "popularity": "One of the original official reference servers, bundled with most MCP setups",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Dev tools"
    ],
    "safetyFlags": [
      "Can change, delete, or run things on your systems."
    ],
    "source": "seed",
    "recommended": true
  },
  {
    "id": "mcp-memory",
    "name": "Memory",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    "description": "Gives Claude a simple persistent notebook so it can remember facts between conversations.",
    "goodFor": [
      "Remembering preferences across sessions",
      "Building a personal knowledge graph",
      "Avoiding repeating yourself to Claude"
    ],
    "features": [
      "Simple knowledge-graph storage",
      "Persists between sessions",
      "Local file-based storage"
    ],
    "requirements": "No setup — works out of the box",
    "popularity": "Official reference server, commonly paired with personal-assistant setups",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Other"
    ],
    "safetyFlags": [],
    "source": "seed",
    "recommended": true
  },
  {
    "id": "mcp-sequential-thinking",
    "name": "Sequential Thinking",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    "description": "Helps Claude break a hard problem into clear step-by-step reasoning before answering.",
    "goodFor": [
      "Complex multi-step planning",
      "Problems that need careful reasoning",
      "Reducing mistakes on tricky tasks"
    ],
    "features": [
      "Structured step-by-step thought tracking",
      "Revisable reasoning steps",
      "No external data needed"
    ],
    "requirements": "No setup — works out of the box",
    "popularity": "Official reference server, popular for planning-heavy tasks",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "AI & data"
    ],
    "safetyFlags": [],
    "source": "seed",
    "recommended": true
  },
  {
    "id": "mcp-sentry",
    "name": "Sentry",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/getsentry/sentry-mcp",
    "description": "Lets Claude look up and help fix errors and performance issues tracked in Sentry.",
    "goodFor": [
      "Investigating production errors",
      "Summarizing crash reports",
      "Connecting error data to code fixes"
    ],
    "features": [
      "Issue and error lookup",
      "Performance and trace data access",
      "Claude Code plugin with auto-delegation subagent"
    ],
    "requirements": "Needs a Sentry account and auth token",
    "popularity": "Official Sentry server, actively released (v0.37+)",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Dev tools"
    ],
    "safetyFlags": [],
    "source": "seed",
    "recommended": true
  },
  {
    "id": "mcp-brave-search",
    "name": "Brave Search",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/brave/brave-search-mcp-server",
    "description": "Lets Claude search the web using Brave's search engine for up-to-date answers.",
    "goodFor": [
      "General web search",
      "Local business and place lookups",
      "News and image search"
    ],
    "features": [
      "Web, image, video, and news search",
      "Local points-of-interest search",
      "AI summarization of results"
    ],
    "requirements": "Needs a free or paid Brave Search API key",
    "popularity": "Official successor to the original archived MCP reference Brave Search server",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Web search & scraping"
    ],
    "safetyFlags": [
      "Needs an API key or account login — you'll be asked for it."
    ],
    "source": "seed",
    "recommended": false
  },
  {
    "id": "mcp-everything",
    "name": "Everything (Test Server)",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/modelcontextprotocol/servers/tree/main/src/everything",
    "description": "A demo server that shows off everything the Model Context Protocol can do, mainly used to check a setup works.",
    "goodFor": [
      "Testing that your MCP setup works",
      "Learning what MCP servers can do",
      "Debugging client compatibility"
    ],
    "features": [
      "Exercises prompts, tools, and resources",
      "Reference implementation for developers",
      "Sample tools of every kind"
    ],
    "requirements": "No setup — works out of the box",
    "popularity": "Official reference/test server maintained by the MCP team",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Dev tools"
    ],
    "safetyFlags": [],
    "source": "seed",
    "recommended": true
  },
  {
    "id": "mcp-notion",
    "name": "Notion",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/makenotion/notion-mcp-server",
    "description": "Lets Claude read and edit your Notion pages, databases, and notes.",
    "goodFor": [
      "Reading and updating Notion pages and databases",
      "Summarizing notes",
      "Automating Notion workflows"
    ],
    "features": [
      "Page, database, and block access",
      "Comment reading and writing",
      "Supports Notion's newer data-source API"
    ],
    "requirements": "Needs a Notion integration token",
    "popularity": "Official Notion server; Notion is now prioritizing its hosted remote version",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Databases"
    ],
    "safetyFlags": [],
    "source": "seed",
    "recommended": true
  },
  {
    "id": "mcp-stripe",
    "name": "Stripe Agent Toolkit",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://github.com/stripe/agent-toolkit",
    "description": "Lets Claude help manage Stripe payments, customers, subscriptions, and invoices.",
    "goodFor": [
      "Looking up customers and payments",
      "Creating and managing invoices/subscriptions",
      "Automating billing tasks"
    ],
    "features": [
      "Payments, refunds, and subscription tools",
      "Also available as a hosted remote server",
      "SDKs for multiple agent frameworks"
    ],
    "requirements": "Needs a Stripe secret API key",
    "popularity": "Official Stripe toolkit, widely used for commerce automation",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Payments & commerce"
    ],
    "safetyFlags": [
      "Needs an API key or account login — you'll be asked for it."
    ],
    "source": "seed",
    "recommended": true
  },
  {
    "id": "mcp-figma",
    "name": "Figma Dev Mode",
    "type": "mcp",
    "status": "reviewed",
    "url": "https://developers.figma.com/docs/figma-mcp-server/",
    "description": "Lets Claude see your Figma designs and turn them directly into code.",
    "goodFor": [
      "Turning a design into working front-end code",
      "Extracting colors, spacing, and fonts from a design",
      "Keeping code in sync with design files"
    ],
    "features": [
      "Design-to-code generation",
      "Extracts design tokens and variables",
      "Works locally via desktop app or via remote server"
    ],
    "requirements": "Needs the Figma desktop app in Dev Mode (or a Figma account for the remote server)",
    "popularity": "Official Figma feature, rolled out through 2025-2026",
    "lastVerified": "2026-07-15",
    "trustTier": "official",
    "rankScore": 0.85,
    "stale": false,
    "categories": [
      "Design & media"
    ],
    "safetyFlags": [],
    "source": "seed",
    "recommended": true
  },
];

/**
 * The two tools the loop was actually asked to install (PRs #60 and #62 in the
 * activity list below).
 */
const CATALOG_REQUESTED_IDS = ["mcp-memory", "mcp-playwright"];

/* ------------------------------------------------------------------ */
/* 2. Install activity — the real tool-install runs and their PRs       */
/* ------------------------------------------------------------------ */

const INSTALL_RUNS: RunSummary[] = [
  {
    id: 29616269119,
    name: "claude-tool-install",
    workflowFile: "claude-tool-install.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-07-17T21:55:28Z",
    updatedAt: "2026-07-17T22:13:04Z",
    runStartedAt: "2026-07-17T21:55:28Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/29616269119",
    event: "repository_dispatch",
    displayName: "Tool installer",
  },
  {
    id: 29616253072,
    name: "claude-tool-install",
    workflowFile: "claude-tool-install.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-07-17T21:55:07Z",
    updatedAt: "2026-07-17T22:09:26Z",
    runStartedAt: "2026-07-17T21:55:07Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/29616253072",
    event: "repository_dispatch",
    displayName: "Tool installer",
  },
];

const INSTALL_PRS: ToolPr[] = [
  {
    number: 60,
    title: "Add shared Memory (MCP server) to the loop — config + prepared wiring (needs #59)",
    branch: "claude/add-memory-mcp-server",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/pull/60",
    createdAt: "2026-07-17T22:08:58Z",
  },
  {
    number: 62,
    title: "Add Playwright browser tool (MCP) to the autonomous loop",
    branch: "claude/add-playwright-mcp",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/pull/62",
    createdAt: "2026-07-17T22:12:41Z",
  },
];

/* ------------------------------------------------------------------ */
/* 3. Needs you — the real "🔑 Action needed" issues the loop filed     */
/* ------------------------------------------------------------------ */

const NEEDS_YOU_ISSUES: ActionIssue[] = [
  {
    number: 61,
    title: "🔑 Action needed: Playwright (MCP server)",
    body: `Hi — this is a short, optional follow-up to the Playwright browser tool PR
(\`claude/add-playwright-mcp\`). **In most cases you won't need to do anything here.**

### The plain-English situation
Your loop's agents live in special files GitHub calls **"workflows."** For safety, GitHub
does **not** let the loop's own login edit those workflow files. The normal way to switch a
new tool on for an agent is to edit those files — so that door is closed to me.

So I turned the Playwright browser tool on a **different, allowed way**: through one shared
settings file (\`.claude/settings.json\`) plus registering the tool in \`.mcp.json\`. This should
switch it on for every agent **automatically**, with nothing for you to do.

I just couldn't *prove* that from inside the cloud run. This issue is the **backup plan** in
case the browser tool doesn't show up on its own.

### How you'll know if the backup is even needed
After the PR is merged, the next time the **Demo** or **Builder** agent works on a screen, it
should mention using the browser / attach screenshots. If it never does over a few runs, do
the backup below.

### The backup (a one-time permission flip — ~1 minute)
This lets the loop edit its own workflow files, which **also fixes a separate problem**: your
weekly **Retro** agent currently can't edit them either.

1. Go to your repository on GitHub: **Settings** (top menu of the repo).
2. In the left sidebar, open **GitHub Apps** (under "Integrations"), or go to the app that
   posts as **\`claude[bot]\`** and open its **Configure / Permissions** page.
3. Find **Repository permissions → Workflows** and set it to **Read and write**.
4. **Save**, then **accept/approve** the new permission when GitHub asks (this is the step
   that actually applies it).
5. That's it. Tell me "@claude finish wiring Playwright" on this issue, or just re-run the
   **Tool-installer**, and the exact tool-enable edits will be applied to the workflow files.

If you're not sure which app \`claude[bot]\` is, forward this issue to whoever set up the
automation — the change takes them under a minute.

---

<details>
<summary><b>For a developer — the exact manual edit (if you'd rather just do it)</b></summary>

In each of these six files, append \`,mcp__playwright\` to the \`--allowedTools "..."\` string
(it currently ends \`...,WebSearch,WebFetch"\`):

- \`.github/workflows/claude-scout.yml\`
- \`.github/workflows/claude-builder.yml\`
- \`.github/workflows/claude-audit.yml\`
- \`.github/workflows/claude-demo.yml\`
- \`.github/workflows/claude-retro.yml\`
- \`.github/workflows/claude-mention.yml\`

Result: \`--allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch,mcp__playwright"\`

\`.allowedTools\` **replaces** the default toolset, so every existing tool must stay — only
\`,mcp__playwright\` is added. The server itself is already registered in \`.mcp.json\` by the PR,
and per-agent guidance is already in \`CLAUDE.md\`, so no other change is required. (This manual
edit is only necessary if the \`.claude/settings.json\` allow-rule in the PR does not take
effect in claude-code-action.)
</details>
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/61",
    createdAt: "2026-07-17T22:12:16Z",
  },
  {
    number: 59,
    title: "🔑 Action needed: Memory (MCP server) — grant the Workflows permission",
    body: `Hi! I set up a **shared memory** for all your automated helpers, but GitHub stopped me
at the last step because of a safety rule — and only you can lift it. It's about a
2-minute job. Here's exactly what and why, in plain English.

### Why this is needed
To switch the memory on, I have to edit the small setup files that control your helpers
(the files under \`.github/workflows/\`). GitHub does **not** let the automation edit those
files on its own unless it has a special "Workflows" permission. This is a deliberate
safety rule on GitHub's side — it stops automated bots from quietly rewriting how your
other automations run. So this one grant has to come from you.

Everything else is already done and waiting: the memory tool is added and tested, and the
exact edits for your seven helpers are prepared in the pull request that links to this
issue.

### What to do (about 2 minutes)
1. On a computer (easier than the phone for this one), open:
   **https://github.com/settings/installations**
2. In the list of installed apps, find **Claude** (it may show as "Claude" or "Claude
   Code"). Click the **Configure** button next to it.
3. Look for a yellow banner at the top asking you to **review/approve new permissions**.
   If you see it, click **Approve** / **Accept new permissions**. (One of the permissions
   is called **Workflows** — that's the one we need.)
4. If there's no banner, scroll to the **Repository permissions** section and check whether
   **Workflows** is listed as *Read and write*. If GitHub gives you a way to enable it here,
   turn it on and save.
5. Once that's done, go back to your dashboard and **re-send the same tool** — "Memory
   (MCP server)", target **all** — exactly like you did the first time. The automation will
   see the new permission and finish wiring the memory into every helper on its own.

### If step 3/4 doesn't show a "Workflows" option
No problem — that just means it needs a slightly more technical route (creating a one-off
access token). **Comment "no workflows option" on this issue** and I'll walk a helper
through it, or handle it on the next run. Don't worry about getting it perfect.

### What's safe to know
- The memory tool needs **no account and no API key** — nothing to buy or sign up for.
- This permission only lets your own automation update your own helper files. You can
  revoke it anytime the same way.

Thanks! Once this is granted and you re-send the tool, your helpers will start remembering
what you approve, what you reject, and where the app tends to break — so they stop repeating
themselves.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/59",
    createdAt: "2026-07-17T22:08:33Z",
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
  { value: "118", label: "#118 — Teach the app to copy your videos people actually WATCH — not just the ones that got shown" },
  { value: "115", label: "#115 — Stop re-buying the same AI images every video — cache & reuse atmospheric stills to cut the image bill" },
  { value: "114", label: "#114 — TikTok auto-publish is silently broken whenever YouTube posts first — the second platform never goes live" },
  { value: "110", label: "#110 — The crash-recovery safety net can wrongly kill a video that's still rendering — and make you pay to render it twice" },
  { value: "109", label: "#109 — Your sports videos skip the 'will this get demonetized?' safety check that true-crime and history already run" },
  { value: "103", label: "#103 — Add a high-paying niche (money/business explainers) — same effort per video, 2-4x the ad rate" },
  { value: "102", label: "#102 — A stalled sports data fetch can freeze a video run for 30 minutes — add the same timeout the true-crime pipeline already has" },
  { value: "101", label: "#101 — Auto-make a click-worthy thumbnail for each video — right now there isn't one" },
  { value: "100", label: "#100 — Give YouTube and TikTok their own copy of each video, so they stop burying it as 'reused content'" },
  { value: "89", label: "#89 — You already score each video's hook — use it to skip publishing the ones likely to flop" },
  { value: "87", label: "#87 — Turn each week's shorts into one long YouTube video — 50-200x the pay, and the only real path to getting monetized" },
  { value: "86", label: "#86 — Check every video against YouTube's 2026 'AI slop' demonetization rules BEFORE it posts" },
];

const CLAUDE_PR_OPTIONS: Option[] = [
  { value: "131", label: "#131 — Apply the Warm Creator look: light by default, dark toggle, one nav bar" },
  { value: "128", label: "#128 — [retro] Week of 2026-07-27 — record the idle-Builder week + the first idea-quality lesson" },
  { value: "125", label: "#125 — Fix sports videos going out with the big hook text missing" },
  { value: "124", label: "#124 — Make a 60s+ cut for TikTok only, so those posts can actually earn" },
  { value: "123", label: "#123 — Stop the voice mispronouncing names & acronyms — add a pronunciation step before every voiceover" },
  { value: "121", label: "#121 — Cut the AI writing bill on true-crime & history videos (prompt caching fix)" },
  { value: "120", label: "#120 — Give TikTok its own caption so cross-posts aren't seen as 'reused' (#88)" },
  { value: "119", label: "#119 — Fix: video previews now play & scrub on Mac Safari and iPhone" },
  { value: "117", label: "#117 — Auto-post your videos to Facebook Reels too (in addition to YouTube + TikTok)" },
  { value: "116", label: "#116 — Tell me when my paid voice breaks — stop silently posting in the free robot voice (#57)" },
  { value: "113", label: "#113 — Put your links & CTAs on every video — earn before monetization (#27)" },
  { value: "112", label: "#112 — Protect Sports from demonetization: extend the anti-repetition gate to every factory (#17)" },
  { value: "62", label: "#62 — Add Playwright browser tool (MCP) to the autonomous loop" },
];

/** The ten workflow files really present in .github/workflows/ on that repo. */
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

/**
 * Real commits against each agent's workflow file.
 *
 * Two commits from the same listing are left out because their diffs are 27 KB
 * and 121 KB of patch text — "Add dashboard-support workflows (#44)" and
 * "Loop: roll out audited workflow updates from the dashboard template".
 * Entries are dropped whole; nothing was trimmed or edited.
 */
const INSTRUCTION_GROUPS: { file: string; name: string; commits: InstructionCommit[] }[] = [
  {
    file: "claude-scout.yml",
    name: "Scout",
    commits: [
      {
        sha: "ae799942b906126975fa51af80e6bfc87295f743",
        message: "Loop: Scout dedups against open PRs + approved ideas (pull-requests: read)",
        author: "ApagPlayz",
        date: "2026-07-23T03:10:33Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/ae799942b906126975fa51af80e6bfc87295f743",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "a5125580f8679805b50b7d06fc453e9cb2a3a939",
        message: "loop-config: replace hardcoded overnight cap-lift and unconditional self-pick with configurable .github/loop-config.json settings (default: approval-required, no time-of-day cap lift)",
        author: "ApagPlayz",
        date: "2026-07-20T13:57:52Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/a5125580f8679805b50b7d06fc453e9cb2a3a939",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "241011221ef5e044704d14d81c7f72bf626911e5",
        message: "Assign issues and PRs to the owner, or he never sees them (#22)",
        author: "ApagPlayz",
        date: "2026-07-14T16:05:52Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/241011221ef5e044704d14d81c7f72bf626911e5",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
    ],
  },
  {
    file: "claude-builder.yml",
    name: "Builder",
    commits: [
      {
        sha: "e02f1130fdd83b77620a3171ec993e35503a0307",
        message: "Loop: Builder claim-detection matches issue# in PR title + branch, not just body",
        author: "ApagPlayz",
        date: "2026-07-23T03:10:39Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/e02f1130fdd83b77620a3171ec993e35503a0307",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "1f0a6863f23eef75f30323b307686485a471d03b",
        message: "loop-config: support prCap: \"unlimited\" (mirrors ideaQueueCap)",
        author: "ApagPlayz",
        date: "2026-07-21T17:00:04Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/1f0a6863f23eef75f30323b307686485a471d03b",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "fa3473d284d6397d014bcc868b7326fbf01f3974",
        message: "loop-config: replace hardcoded overnight cap-lift and unconditional self-pick with configurable .github/loop-config.json settings (default: approval-required, no time-of-day cap lift)",
        author: "ApagPlayz",
        date: "2026-07-20T13:57:50Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/fa3473d284d6397d014bcc868b7326fbf01f3974",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
    ],
  },
  {
    file: "claude-audit.yml",
    name: "Auditor",
    commits: [
      {
        sha: "211a9201fbb07a4bf4fee46ff37de50068bffc4c",
        message: "loop-config: re-trigger Auditor/Demo/Tests after an @mention pushes a follow-up fix to an existing PR (GITHUB_TOKEN pushes don't cascade pull_request:synchronize, so the old verdict was staying stale forever)",
        author: "ApagPlayz",
        date: "2026-07-20T14:53:27Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/211a9201fbb07a4bf4fee46ff37de50068bffc4c",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "59c22f91ec6e5b26f111a6b1238093854751366a",
        message: "Let the Auditor review the Builder's PRs (allowed_bots) (#24)",
        author: "ApagPlayz",
        date: "2026-07-14T16:15:40Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/59c22f91ec6e5b26f111a6b1238093854751366a",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "b7c27d4cbb3fe0c2650d349fc25efaccbaadcf24",
        message: "Agents were ending their turn while their subagents were still running (#13)",
        author: "ApagPlayz",
        date: "2026-07-14T15:00:52Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/b7c27d4cbb3fe0c2650d349fc25efaccbaadcf24",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
    ],
  },
  {
    file: "claude-retro.yml",
    name: "Retro",
    commits: [
      {
        sha: "56cf76af097c3e02148169bdbdb1dc071d6faaea",
        message: "Make the loop actually run — fix the silent no-op, then run it continuously (#11)",
        author: "ApagPlayz",
        date: "2026-07-14T11:48:45Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/56cf76af097c3e02148169bdbdb1dc071d6faaea",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "559657f5a3013ebb9f5052cd0cc63257b058e291",
        message: "Fix: allow agents to actually use gh/git (loop was silently no-op) (#10)",
        author: "ApagPlayz",
        date: "2026-07-13T16:04:02Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/559657f5a3013ebb9f5052cd0cc63257b058e291",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "6e9b6bde3e5bedd95ac8298261e3fb44e0840d6d",
        message: "Autonomous improvement loop v2: audit, measure, and learn (#8)",
        author: "ApagPlayz",
        date: "2026-07-13T15:53:08Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/6e9b6bde3e5bedd95ac8298261e3fb44e0840d6d",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
    ],
  },
  {
    file: "claude-mention.yml",
    name: "@mention",
    commits: [
      {
        sha: "91a814cbe0fbd4f0371b9ff738f451b6b60f4bec",
        message: "Security: gate the @mention agent behind a permission check",
        author: "ApagPlayz",
        date: "2026-08-18T15:19:40Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/91a814cbe0fbd4f0371b9ff738f451b6b60f4bec",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "a94abd9bd1bbcbddfc97442be3a5610d59a2683d",
        message: "loop-config: re-trigger Auditor/Demo/Tests after an @mention pushes a follow-up fix to an existing PR (GITHUB_TOKEN pushes don't cascade pull_request:synchronize, so the old verdict was staying stale forever)",
        author: "ApagPlayz",
        date: "2026-07-20T14:53:29Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/a94abd9bd1bbcbddfc97442be3a5610d59a2683d",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
      {
        sha: "0443cd32c0da3398e9559b48015cbbf2707e04b4",
        message: "Builder: start on approval, never build the same issue twice, read the comments (#33)",
        author: "ApagPlayz",
        date: "2026-07-14T20:08:42Z",
        htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/commit/0443cd32c0da3398e9559b48015cbbf2707e04b4",
        // No commit in this repo's workflow history was made through the
        // dashboard's own editor, so this is false everywhere. It is not a
        // placeholder — it is what the real route reports.
        isDashboardEdit: false,
      },
    ],
  },
];

type CommitDiffBody = { message: string; files: FilePatch[] };

const COMMIT_DIFFS: Record<string, CommitDiffBody> = {
  "ae799942b906126975fa51af80e6bfc87295f743": {
    message: "Loop: Scout dedups against open PRs + approved ideas (pull-requests: read)",
    files: [
      {
        filename: ".github/workflows/claude-scout.yml",
        patch: `@@ -24,6 +24,7 @@ jobs:
     permissions:
       contents: read
       issues: write
+      pull-requests: read
       id-token: write
     steps:
       - uses: actions/checkout@v6
@@ -59,6 +60,34 @@ jobs:
           # Actions expressions have no arithmetic — do the subtraction here.
           echo "room=$((CAP - pool))" >> "$GITHUB_OUTPUT"
 
+          # Also surface work that's already in flight elsewhere, so the agent doesn't
+          # propose something an open PR is already building, or something already
+          # approved and just waiting on the Builder. Best-effort: an empty list or a
+          # transient gh error must never fail this step.
+          open_prs=$(gh pr list --state open --json number,title,headRefName \\
+            --jq '.[] | "#\\(.number) \\(.title) (branch: \\(.headRefName))"' 2>/dev/null || true)
+          [ -z "$open_prs" ] && open_prs="(none)"
+
+          approved_ideas=$(gh issue list --state open --label approved --json number,title \\
+            --jq '.[] | "#\\(.number) \\(.title)"' 2>/dev/null || true)
+          [ -z "$approved_ideas" ] && approved_ideas="(none)"
+
+          echo "Open PRs in flight:"
+          echo "$open_prs"
+          echo "Approved ideas awaiting build:"
+          echo "$approved_ideas"
+
+          {
+            echo "open_prs<<PREOF"
+            echo "$open_prs"
+            echo "PREOF"
+          } >> "$GITHUB_OUTPUT"
+          {
+            echo "approved_ideas<<APPEOF"
+            echo "$approved_ideas"
+            echo "APPEOF"
+          } >> "$GITHUB_OUTPUT"
+
       - if: steps.gate.outputs.go == 'true'
         uses: anthropics/claude-code-action@v1
         with:
@@ -109,6 +138,19 @@ jobs:
                ignores. This is how you get better at your job.
             3. Read every open issue already labeled \`proposal\`
                (\`gh issue list --state open --label proposal\`). NEVER duplicate one.
+
+               Before proposing, also review these OPEN PULL REQUESTS and APPROVED ideas —
+               both are work already in flight, not just the \`proposal\` pool:
+
+               Open pull requests:
+               \${{ steps.gate.outputs.open_prs }}
+
+               Approved ideas (approved but not yet built):
+               \${{ steps.gate.outputs.approved_ideas }}
+
+               NEVER propose something already covered by an open PR or an already-approved
+               idea — it is already in flight. Your proposals must be genuinely NEW work not
+               represented anywhere in: open proposals, open PRs, or approved ideas.
             4. Spawn FOUR researchers with the Task tool, in ONE message, each with
                \`run_in_background: false\` so you block until all four have returned:
                - Competitors: who else does this, what do they have that we don't.`,
        additions: 42,
        deletions: 0,
      },
    ],
  },
  "a5125580f8679805b50b7d06fc453e9cb2a3a939": {
    message: "loop-config: replace hardcoded overnight cap-lift and unconditional self-pick with configurable .github/loop-config.json settings (default: approval-required, no time-of-day cap lift)",
    files: [
      {
        filename: ".github/workflows/claude-scout.yml",
        patch: `@@ -2,8 +2,11 @@ name: Claude — Scout (finds work worth doing)
 
 # Runs every hour. Researches the market + the codebase, then files issues labeled
 # \`proposal\`. It NEVER writes code — it only stocks the shelf that the Builder picks
-# from. A cheap bash gate keeps the pool at 8 open proposals, so most hourly runs
-# cost ~15 seconds and never boot an agent.
+# from. A cheap bash gate keeps the open-proposal pool under the repo's configured
+# cap (\`.github/loop-config.json\`, \`ideaQueueCap\` — set from the dashboard's Ideas
+# page; defaults to 25 if the file is missing), so most hourly runs cost ~15 seconds
+# and never boot an agent. Because this runs every hour regardless of time of day,
+# ideas accumulate steadily throughout the day up to the cap, not in an overnight burst.
 
 on:
   schedule:
@@ -25,23 +28,36 @@ jobs:
     steps:
       - uses: actions/checkout@v6
 
+      # Read the per-project cap. Missing file or missing field both fall back to 25 —
+      # this repo may not have been backfilled with a loop-config.json yet.
+      - name: Read loop config
+        id: config
+        run: |
+          cap=$(jq -r '.ideaQueueCap // 25' .github/loop-config.json 2>/dev/null || echo 25)
+          if [ "$cap" = "unlimited" ] || [ "$cap" = "null" ] || [ -z "$cap" ]; then
+            cap=999999
+          fi
+          echo "Idea queue cap: $cap"
+          echo "cap=$cap" >> "$GITHUB_OUTPUT"
+
       # Cheap pre-flight in plain bash so we never boot an expensive agent for nothing.
       - name: Check the proposal pool
         id: gate
         env:
           GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+          CAP: \${{ steps.config.outputs.cap }}
         run: |
           pool=$(gh issue list --state open --label proposal --json number --jq 'length')
-          echo "Open proposals: $pool"
-          if [ "$pool" -ge 8 ]; then
+          echo "Open proposals: $pool / $CAP"
+          if [ "$pool" -ge "$CAP" ]; then
             echo "Pool is full — standing down. An unread queue is noise, not a backlog."
             echo "go=false" >> "$GITHUB_OUTPUT"
           else
             echo "go=true" >> "$GITHUB_OUTPUT"
           fi
           echo "pool=$pool" >> "$GITHUB_OUTPUT"
           # Actions expressions have no arithmetic — do the subtraction here.
-          echo "room=$((8 - pool))" >> "$GITHUB_OUTPUT"
+          echo "room=$((CAP - pool))" >> "$GITHUB_OUTPUT"
 
       - if: steps.gate.outputs.go == 'true'
         uses: anthropics/claude-code-action@v1
@@ -80,7 +96,8 @@ jobs:
             green and the owner got nothing. Do not repeat it.
             ────────────────────────────────────────────────────────────────────────
 
-            There are currently \${{ steps.gate.outputs.pool }} open proposals. The pool caps at 8.
+            There are currently \${{ steps.gate.outputs.pool }} open proposals. The pool caps at
+            \${{ steps.config.outputs.cap }}.
             File at most \${{ steps.gate.outputs.room }} new issues — fewer if you
             only found fewer things genuinely worth doing.
 `,
        additions: 23,
        deletions: 6,
      },
    ],
  },
  "241011221ef5e044704d14d81c7f72bf626911e5": {
    message: "Assign issues and PRs to the owner, or he never sees them (#22)",
    files: [
      {
        filename: ".github/workflows/claude-builder.yml",
        patch: `@@ -134,8 +134,11 @@ jobs:
             blocked you, in plain English, and stop. A blocked run that says so is a success.
             A green-looking broken PR is a failure.
 
-            SHIP: open ONE pull request from a \`claude/\` branch with \`Closes #<issue>\` in the
-            body. Write the description for a NON-TECHNICAL owner reading on a phone:
+            SHIP: open ONE pull request from a \`claude/\` branch, with
+            \`--assignee \${{ github.repository_owner }} --reviewer \${{ github.repository_owner }}\`
+            and \`Closes #<issue>\` in the body. The assignee and reviewer flags are NOT optional:
+            without them the PR never reaches the owner's GitHub inbox and he will never know it
+            exists. Write the description for a NON-TECHNICAL owner reading on a phone:
               1. What changed
               2. Why it matters
               3. How to check it works — click by click`,
        additions: 5,
        deletions: 2,
      },
      {
        filename: ".github/workflows/claude-scout.yml",
        patch: `@@ -99,8 +99,11 @@ jobs:
                - Codebase: what is fragile, untested, or half-finished in our own code.
                - Revenue: what would plausibly make this product money or save it money.
                Do not proceed to step 5 until you are holding all four reports.
-            5. File each proposal with \`gh issue create --label proposal\`. THIS IS THE STEP THAT
-               MATTERS — everything above is worthless without it. Each issue must have:
+            5. File each proposal with
+               \`gh issue create --label proposal --assignee \${{ github.repository_owner }}\`.
+               THIS IS THE STEP THAT MATTERS — everything above is worthless without it.
+               The \`--assignee\` is not optional: without it the issue never reaches the owner's
+               GitHub inbox and he will never see it. Each issue must have:
                - A plain-English title a non-technical owner instantly understands
                - What to build, and why it matters to the product's success
                - Evidence: links, quotes, or a specific file that proves the problem is real`,
        additions: 5,
        deletions: 2,
      },
    ],
  },
  "e02f1130fdd83b77620a3171ec993e35503a0307": {
    message: "Loop: Builder claim-detection matches issue# in PR title + branch, not just body",
    files: [
      {
        filename: ".github/workflows/claude-builder.yml",
        patch: `@@ -78,14 +78,21 @@ jobs:
           open_prs=$(gh pr list --state open --json headRefName \\
             --jq '[.[] | select(.headRefName | startswith("claude/"))] | length')
 
-          # Issues that an OPEN agent PR already claims (via "Closes #N" in its body).
-          # Without this the Builder rebuilds an issue it is already building: on
-          # 2026-07-14 two runs both picked issue #15, both spent ~14 minutes, and
-          # produced two PRs for one feature. Telling the agent "I've started this" in
-          # an issue comment is NOT protection — the next run never reads it. This is.
-          claimed=$(gh pr list --state open --json headRefName,body \\
+          # Issues that an OPEN agent PR already claims. Without this the Builder rebuilds
+          # an issue it is already building: on 2026-07-14 two runs both picked issue #15,
+          # both spent ~14 minutes, and produced two PRs for one feature. Telling the agent
+          # "I've started this" in an issue comment is NOT protection — the next run never
+          # reads it. This is.
+          # Detected three ways: "Closes #N" in the body, "(#N)" in the PR title, and an
+          # issue number embedded in the branch name itself (e.g. \`claude/issue-15-foo\` or
+          # \`claude/foo-15\`) — the body scan alone misses PRs that only recorded the issue
+          # number in the title or branch.
+          claimed=$(gh pr list --state open --json headRefName,title,body \\
             --jq '[.[] | select(.headRefName | startswith("claude/"))
-                       | (.body // "") | scan("(?i)closes #([0-9]+)") | .[0]]
+                       | ( (.body // "") | scan("(?i)closes #([0-9]+)") | .[0] ),
+                         ( (.title // "") | scan("\\\\(#([0-9]+)\\\\)") | .[0] ),
+                         ( (.headRefName // "") | scan("issue-([0-9]+)(?:-|$)") | .[0] ),
+                         ( (.headRefName // "") | scan("-([0-9]+)$") | .[0] )]
                   | unique | join(", ")')
           [ -z "$claimed" ] && claimed="(none)"
 `,
        additions: 14,
        deletions: 7,
      },
    ],
  },
  "1f0a6863f23eef75f30323b307686485a471d03b": {
    message: "loop-config: support prCap: \"unlimited\" (mirrors ideaQueueCap)",
    files: [
      {
        filename: ".github/workflows/claude-builder.yml",
        patch: `@@ -58,6 +58,9 @@ jobs:
         id: config
         run: |
           cap=$(jq -r '.prCap // 3' .github/loop-config.json 2>/dev/null || echo 3)
+          if [ "$cap" = "unlimited" ] || [ "$cap" = "null" ] || [ -z "$cap" ]; then
+            cap=999999
+          fi
           autonomous=$(jq -r '.autonomousBuildEnabled // false' .github/loop-config.json 2>/dev/null || echo false)
           [ "$autonomous" = "true" ] || autonomous=false
           echo "Review-queue cap: $cap | Autonomous build: $autonomous"`,
        additions: 3,
        deletions: 0,
      },
    ],
  },
  "fa3473d284d6397d014bcc868b7326fbf01f3974": {
    message: "loop-config: replace hardcoded overnight cap-lift and unconditional self-pick with configurable .github/loop-config.json settings (default: approval-required, no time-of-day cap lift)",
    files: [
      {
        filename: ".github/workflows/claude-builder.yml",
        patch: `@@ -9,15 +9,16 @@ name: Claude — Builder (implements work, keeps your queue full)
 # because the Builder simply never woke up. Now approving from the phone starts a build
 # within a minute, and the schedule is only a safety net.
 #
-# THE QUEUE RULE:
-#   - Daytime (7am–11pm ET): at most 3 agent PRs may be open and waiting on you at once.
-#     Merge or close one and a slot frees up; the next run fills it.
-#   - Overnight (11pm–7am ET): the cap is lifted, so work piles up while you sleep.
-#
-# WHAT IT BUILDS:
-#   - An issue you labeled \`approved\` always jumps the queue and gets built first.
-#   - Otherwise it picks the strongest open \`proposal\` on its own. You do not have to
-#     approve anything for the loop to keep moving.
+# THE QUEUE RULE — both numbers below are configurable per-project from the dashboard's
+# Ideas page, stored in this repo's \`.github/loop-config.json\`. No time-of-day special
+# casing: the same rule applies at 3pm and at 3am.
+#   - \`prCap\` (default 3): at most this many agent PRs may be open and waiting on you at
+#     once. Merge or close one and a slot frees up; the next run fills it.
+#   - \`autonomousBuildEnabled\` (default false):
+#       - OFF — the Builder only ever builds an issue you've explicitly labeled
+#         \`approved\`. It is never told that self-picking a proposal is an option.
+#       - ON — if nothing is \`approved\`, it picks the strongest open \`proposal\` on its
+#         own. You do not have to approve anything for the loop to keep moving.
 #   - It NEVER picks an issue that already has an open \`claude/\` PR against it.
 #
 # A cheap bash gate runs first, so a run with no room and no work costs ~15 seconds.
@@ -49,22 +50,28 @@ jobs:
         with:
           fetch-depth: 0
 
+      # Read this repo's automation settings. Missing file or missing field falls back
+      # to the safe default (prCap 3, autonomous build OFF) — a repo that hasn't been
+      # backfilled with loop-config.json yet, or hasn't visited the Ideas page settings
+      # panel, gets the conservative behavior, never the permissive one.
+      - name: Read loop config
+        id: config
+        run: |
+          cap=$(jq -r '.prCap // 3' .github/loop-config.json 2>/dev/null || echo 3)
+          autonomous=$(jq -r '.autonomousBuildEnabled // false' .github/loop-config.json 2>/dev/null || echo false)
+          [ "$autonomous" = "true" ] || autonomous=false
+          echo "Review-queue cap: $cap | Autonomous build: $autonomous"
+          echo "cap=$cap" >> "$GITHUB_OUTPUT"
+          echo "autonomous=$autonomous" >> "$GITHUB_OUTPUT"
+
       # Cheap pre-flight in plain bash so we never boot an expensive agent for nothing.
       - name: Check the queue
         id: gate
         env:
           GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+          CAP: \${{ steps.config.outputs.cap }}
+          AUTONOMOUS: \${{ steps.config.outputs.autonomous }}
         run: |
-          hour=$(TZ=America/New_York date +%H)
-          hour=\${hour#0}
-          if [ "$hour" -ge 23 ] || [ "$hour" -lt 7 ]; then
-            cap=99
-            echo "Overnight (\${hour}:00 ET) — review-queue cap lifted."
-          else
-            cap=3
-            echo "Daytime (\${hour}:00 ET) — review-queue cap is 3."
-          fi
-
           open_prs=$(gh pr list --state open --json headRefName \\
             --jq '[.[] | select(.headRefName | startswith("claude/"))] | length')
 
@@ -81,15 +88,28 @@ jobs:
 
           approved=$(gh issue list --state open --label approved --json number --jq 'length')
           proposals=$(gh issue list --state open --label proposal --json number --jq 'length')
-          echo "Agent PRs awaiting you: $open_prs / $cap | approved: $approved | proposals: $proposals"
+          echo "Agent PRs awaiting you: $open_prs / $CAP | approved: $approved | proposals: $proposals | autonomous: $AUTONOMOUS"
           echo "Already claimed by an open PR: $claimed"
           echo "claimed=$claimed" >> "$GITHUB_OUTPUT"
 
-          if [ "$open_prs" -ge "$cap" ]; then
+          if [ "$AUTONOMOUS" = "true" ]; then
+            pick_rule='2. If none are approved, choose the SINGLE strongest open issue labeled \`proposal\` — judge by value to the product against effort and risk, and prefer small. You are trusted to choose. Do not ask, do not build more than one.'
+            nothing_to_build=$([ "$approved" -eq 0 ] && [ "$proposals" -eq 0 ] && echo true || echo false)
+          else
+            pick_rule='2. If none are approved, STOP without opening a PR. Autonomous build is OFF for this project — you may only build issues the owner has explicitly labeled \`approved\`. Do not self-pick a proposal, no matter how strong it looks, and do not comment suggesting one — the owner has chosen to review before anything gets built.'
+            nothing_to_build=$([ "$approved" -eq 0 ] && echo true || echo false)
+          fi
+          {
+            echo "pick_rule<<PICKEOF"
+            echo "$pick_rule"
+            echo "PICKEOF"
+          } >> "$GITHUB_OUTPUT"
+
+          if [ "$open_prs" -ge "$CAP" ]; then
             echo "Your review queue is full — standing down. Merge or close one to free a slot."
             echo "go=false" >> "$GITHUB_OUTPUT"
-          elif [ "$approved" -eq 0 ] && [ "$proposals" -eq 0 ]; then
-            echo "Nothing to build — the shelf is empty. Scout will restock it."
+          elif [ "$nothing_to_build" = "true" ]; then
+            echo "Nothing to build — the shelf is empty (or autonomous build is off and nothing is approved). Scout will restock it."
             echo "go=false" >> "$GITHUB_OUTPUT"
           else
             echo "go=true" >> "$GITHUB_OUTPUT"
@@ -146,9 +166,7 @@ jobs:
 
             PICK — in this strict order, skipping anything in the off-limits list above:
             1. The OLDEST open issue labeled \`approved\`. The owner asked for it; it always wins.
-            2. If none are approved, choose the SINGLE strongest open issue labeled \`proposal\` —
-               judge by value to the product against effort and risk, and prefer small. You are
-               trusted to choose. Do not ask, do not build more than one.
+            \${{ steps.gate.outputs.pick_rule }}
             3. If neither exists, stop without opening a PR.
 
             READ THE WHOLE CONVERSATION, NOT JUST THE ISSUE BODY:`,
        additions: 44,
        deletions: 26,
      },
    ],
  },
  "211a9201fbb07a4bf4fee46ff37de50068bffc4c": {
    message: "loop-config: re-trigger Auditor/Demo/Tests after an @mention pushes a follow-up fix to an existing PR (GITHUB_TOKEN pushes don't cascade pull_request:synchronize, so the old verdict was staying stale forever)",
    files: [
      {
        filename: ".github/workflows/claude-audit.yml",
        patch: `@@ -8,10 +8,15 @@ name: Claude — Auditor (adversarial PR review)
 on:
   pull_request:
     types: [opened, synchronize, reopened]
+  workflow_dispatch:
+    inputs:
+      pr_number:
+        description: "PR number to (re)audit"
+        required: true
 
 # A new push supersedes an in-flight audit of the same PR — don't pay twice.
 concurrency:
-  group: audit-\${{ github.event.pull_request.number }}
+  group: audit-\${{ github.event.pull_request.number || github.event.inputs.pr_number }}
   cancel-in-progress: true
 
 jobs:
@@ -24,10 +29,35 @@ jobs:
       issues: write
       id-token: write
     steps:
+      # Work out which PR we're on. Handles both the normal pull_request trigger
+      # AND a manual/scripted re-run (workflow_dispatch) — the latter matters
+      # because a follow-up push from the @mention agent uses the default
+      # GITHUB_TOKEN identity, which GitHub's own recursion-prevention rule
+      # silently excludes from ever firing \`pull_request: synchronize\` — so
+      # without this, a fix pushed onto an existing PR would never get
+      # re-audited, and the stale verdict would sit there indefinitely.
+      - name: Resolve PR number
+        id: meta
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: |
+          if [ "\${{ github.event_name }}" = "workflow_dispatch" ]; then
+            pr="\${{ github.event.inputs.pr_number }}"
+          else
+            pr="\${{ github.event.pull_request.number }}"
+          fi
+          echo "PR under review: #$pr"
+          echo "pr_number=$pr" >> "$GITHUB_OUTPUT"
+
       - uses: actions/checkout@v6
         with:
           fetch-depth: 0
 
+      - name: Check out the PR branch
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: gh pr checkout \${{ steps.meta.outputs.pr_number }}
+
       - uses: anthropics/claude-code-action@v1
         with:
           claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
@@ -41,7 +71,7 @@ jobs:
             --max-turns 60
             --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
           prompt: |
-            You are the ADVERSARIAL AUDITOR for PR #\${{ github.event.pull_request.number }}
+            You are the ADVERSARIAL AUDITOR for PR #\${{ steps.meta.outputs.pr_number }}
             in \${{ github.repository }}. Your job is to find reasons this PR should NOT be
             merged. Assume it is subtly broken until you prove otherwise.
 `,
        additions: 32,
        deletions: 2,
      },
    ],
  },
  "59c22f91ec6e5b26f111a6b1238093854751366a": {
    message: "Let the Auditor review the Builder's PRs (allowed_bots) (#24)",
    files: [
      {
        filename: ".github/workflows/claude-audit.yml",
        patch: `@@ -31,6 +31,11 @@ jobs:
       - uses: anthropics/claude-code-action@v1
         with:
           claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
+          # The Builder's PRs are authored by the \`claude\` bot. Without this, the action's
+          # bot-loop guard refuses to run and the Auditor never reviews a single agent PR —
+          # which is the entire point of the Auditor. Scoped to \`claude\`, not \`*\`.
+          allowed_bots: "claude"
+          show_full_output: true
           claude_args: |
             --model opus
             --max-turns 60`,
        additions: 5,
        deletions: 0,
      },
    ],
  },
  "b7c27d4cbb3fe0c2650d349fc25efaccbaadcf24": {
    message: "Agents were ending their turn while their subagents were still running (#13)",
    files: [
      {
        filename: ".github/workflows/claude-audit.yml",
        patch: `@@ -43,7 +43,22 @@ jobs:
             Read LEARNINGS.md first — it lists mistakes this loop has made before. Check for
             repeats of them specifically.
 
-            Use the Task tool to spawn FIVE reviewers IN PARALLEL, one per lens:
+            ────────────────────────────────────────────────────────────────────────
+            HOW THIS RUN WORKS — READ THIS FIRST, IT IS NOT OPTIONAL
+
+            You are running inside a one-shot CI job. **There is no second turn.** The moment you
+            stop producing tool calls, this container is destroyed. Nothing resumes you.
+
+            - Spawn the five reviewers below with \`run_in_background: false\` so you BLOCK and
+              receive their reports. A backgrounded subagent is killed the moment you stop.
+            - NEVER end your turn saying you will "wait for the reviewers" or "report back". There
+              is no later. That sentence means you failed.
+            - Your job is done when the review comment has actually been posted to the PR — not
+              when you have decided on a verdict.
+            ────────────────────────────────────────────────────────────────────────
+
+            Spawn FIVE reviewers with the Task tool, in ONE message, each with
+            \`run_in_background: false\`, one per lens:
               1. Correctness  — does it do what the PR claims? Trace the logic. Find the bug.
               2. Regression   — what existing behavior breaks? Check every caller and import.
               3. Security     — secrets, injection, authz, unsafe deps, exposed endpoints.`,
        additions: 16,
        deletions: 1,
      },
      {
        filename: ".github/workflows/claude-builder.yml",
        patch: `@@ -86,6 +86,25 @@ jobs:
             Read CLAUDE.md and LEARNINGS.md before writing a single line. LEARNINGS.md is the
             record of mistakes this loop has already made — do not repeat them.
 
+            ────────────────────────────────────────────────────────────────────────
+            HOW THIS RUN WORKS — READ THIS FIRST, IT IS NOT OPTIONAL
+
+            You are running inside a one-shot CI job. **There is no second turn.** The moment you
+            stop producing tool calls, this container is destroyed. Nothing resumes you.
+
+            - When you spawn subagents with the Task tool, you MUST pass \`run_in_background: false\`
+              so you BLOCK and receive their reports. A backgrounded subagent is killed the moment
+              you stop, and its work is thrown away.
+            - NEVER end your turn saying you will "wait for" anything or "report back". There is no
+              later. That sentence means you failed.
+            - Your job is done when \`gh pr create\` has actually run and returned a URL — not when
+              you have decided what to build.
+
+            A previous Scout run dispatched four background researchers, announced it would wait
+            for them, ended its turn, and produced nothing while the run went green. Do not repeat
+            that.
+            ────────────────────────────────────────────────────────────────────────
+
             PICK — in this strict order:
             1. The OLDEST open issue labeled \`approved\`. The owner asked for it; it always wins.
             2. If none are approved, choose the SINGLE strongest open issue labeled \`proposal\` —
@@ -99,8 +118,9 @@ jobs:
             PLAN: restate the issue as an explicit acceptance checklist before coding.
 
             BUILD (spend tokens here — this is the point):
-            - Use the Task tool to spawn THREE agents in parallel, each proposing a different
-              implementation approach for this issue.
+            - Spawn THREE agents with the Task tool, in ONE message, each with
+              \`run_in_background: false\` so you block until all three return. Each proposes a
+              different implementation approach for this issue.
             - Judge the three against: smallest honest diff, best fit with existing repo style,
               easiest for a non-technical owner to verify by clicking around.
             - Implement the winner, grafting in the best ideas from the other two.`,
        additions: 22,
        deletions: 2,
      },
      {
        filename: ".github/workflows/claude-scout.yml",
        patch: `@@ -56,6 +56,30 @@ jobs:
             You are the SCOUT for \${{ github.repository }}. You never write or change code.
             You find work that is worth doing, and you make the case for it.
 
+            ────────────────────────────────────────────────────────────────────────
+            HOW THIS RUN WORKS — READ THIS FIRST, IT IS NOT OPTIONAL
+
+            You are running inside a one-shot CI job. **There is no second turn.** The moment you
+            stop producing tool calls, this container is destroyed. Nothing resumes you. Nobody
+            reads your closing message.
+
+            Therefore:
+            - When you spawn subagents with the Task tool, you MUST pass
+              \`run_in_background: false\` so that you BLOCK and receive their reports. A
+              backgrounded subagent is simply killed when you stop. Its work is thrown away.
+            - NEVER end your turn saying you will "wait for the researchers", "report back", or
+              "follow up once they return". There is no later. That sentence means you failed.
+            - Do not idle, sleep, or run filler commands while waiting. Waiting is not a thing
+              you can do here.
+            - Your job is not done when you have decided what to file. **It is done when
+              \`gh issue create\` has actually run and returned an issue URL.** Until then you have
+              produced nothing at all.
+
+            A previous Scout run did exactly this: it dispatched four background researchers,
+            announced it would wait for them, ended its turn, and filed zero issues. The run went
+            green and the owner got nothing. Do not repeat it.
+            ────────────────────────────────────────────────────────────────────────
+
             There are currently \${{ steps.gate.outputs.pool }} open proposals. The pool caps at 8.
             File at most \${{ steps.gate.outputs.room }} new issues — fewer if you
             only found fewer things genuinely worth doing.
@@ -68,12 +92,15 @@ jobs:
                ignores. This is how you get better at your job.
             3. Read every open issue already labeled \`proposal\`
                (\`gh issue list --state open --label proposal\`). NEVER duplicate one.
-            4. Use the Task tool to spawn FOUR researchers IN PARALLEL:
+            4. Spawn FOUR researchers with the Task tool, in ONE message, each with
+               \`run_in_background: false\` so you block until all four have returned:
                - Competitors: who else does this, what do they have that we don't.
                - Users: what do people complain about in this category (forums, reviews).
                - Codebase: what is fragile, untested, or half-finished in our own code.
                - Revenue: what would plausibly make this product money or save it money.
-            5. File each proposal with \`gh issue create --label proposal\`. Each one must have:
+               Do not proceed to step 5 until you are holding all four reports.
+            5. File each proposal with \`gh issue create --label proposal\`. THIS IS THE STEP THAT
+               MATTERS — everything above is worthless without it. Each issue must have:
                - A plain-English title a non-technical owner instantly understands
                - What to build, and why it matters to the product's success
                - Evidence: links, quotes, or a specific file that proves the problem is real
@@ -96,5 +123,7 @@ jobs:
           now=$(gh issue list --state open --label proposal --json number --jq 'length')
           echo "Open proposals: $BEFORE before → $now after"
           if [ "$now" -le "$BEFORE" ]; then
-            echo "::warning::Scout filed nothing this run. Fine if it found nothing; check the log above for permission denials if this repeats."
+            echo "::error::Scout filed ZERO issues. The run is being failed on purpose — a green tick that produced nothing is worse than a red one, because it looks like the loop is working when it is not. Read the agent's final message in the log above: the usual cause is that it backgrounded its researchers and ended its turn instead of blocking on them."
+            exit 1
           fi
+          echo "Scout filed $((now - BEFORE)) new proposal(s)."`,
        additions: 32,
        deletions: 3,
      },
    ],
  },
  "56cf76af097c3e02148169bdbdb1dc071d6faaea": {
    message: "Make the loop actually run — fix the silent no-op, then run it continuously (#11)",
    files: [
      {
        filename: ".github/workflows/claude-audit.yml",
        patch: `@@ -34,7 +34,7 @@ jobs:
           claude_args: |
             --model opus
             --max-turns 60
-            --allowedTools "Bash(gh:*),Bash(git:*),Bash(npm:*),Bash(npx:*),Bash(node:*)"
+            --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
           prompt: |
             You are the ADVERSARIAL AUDITOR for PR #\${{ github.event.pull_request.number }}
             in \${{ github.repository }}. Your job is to find reasons this PR should NOT be`,
        additions: 1,
        deletions: 1,
      },
      {
        filename: ".github/workflows/claude-builder.yml",
        patch: `@@ -1,13 +1,23 @@
-name: Claude — Builder (implements approved issues)
+name: Claude — Builder (implements work, keeps your queue full)
 
-# Runs nightly at 3am ET. Picks the oldest issue YOU labeled \`approved\` and builds it.
-# Two hard gates mean it costs ~1 minute and does nothing unless you have approved work,
-# so the nightly schedule is cheap.
-# You can also start it by hand: Actions tab -> this workflow -> Run workflow.
+# Runs every 30 minutes. Opens ONE pull request per run, and only if your review queue
+# has room.
+#
+# THE QUEUE RULE:
+#   - Daytime (7am–11pm ET): at most 3 agent PRs may be open and waiting on you at once.
+#     Merge or close one and a slot frees up; the next run fills it.
+#   - Overnight (11pm–7am ET): the cap is lifted, so work piles up while you sleep.
+#
+# WHAT IT BUILDS:
+#   - An issue you labeled \`approved\` always jumps the queue and gets built first.
+#   - Otherwise it picks the strongest open \`proposal\` on its own. You do not have to
+#     approve anything for the loop to keep moving.
+#
+# A cheap bash gate runs first, so a run with no room and no work costs ~15 seconds.
 
 on:
   schedule:
-    - cron: "0 7 * * *" # 03:00 America/New_York
+    - cron: "*/30 * * * *" # every 30 minutes
   workflow_dispatch:
 
 concurrency:
@@ -34,15 +44,27 @@ jobs:
         env:
           GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
         run: |
-          open_claude_prs=$(gh pr list --state open --json headRefName \\
+          hour=$(TZ=America/New_York date +%H)
+          hour=\${hour#0}
+          if [ "$hour" -ge 23 ] || [ "$hour" -lt 7 ]; then
+            cap=99
+            echo "Overnight (\${hour}:00 ET) — review-queue cap lifted."
+          else
+            cap=3
+            echo "Daytime (\${hour}:00 ET) — review-queue cap is 3."
+          fi
+
+          open_prs=$(gh pr list --state open --json headRefName \\
             --jq '[.[] | select(.headRefName | startswith("claude/"))] | length')
           approved=$(gh issue list --state open --label approved --json number --jq 'length')
-          echo "Open claude/ PRs: $open_claude_prs | Approved issues waiting: $approved"
-          if [ "$open_claude_prs" -gt 0 ]; then
-            echo "An agent PR is still open — standing down (one at a time)."
+          proposals=$(gh issue list --state open --label proposal --json number --jq 'length')
+          echo "Agent PRs awaiting you: $open_prs / $cap | approved: $approved | proposals: $proposals"
+
+          if [ "$open_prs" -ge "$cap" ]; then
+            echo "Your review queue is full — standing down. Merge or close one to free a slot."
             echo "go=false" >> "$GITHUB_OUTPUT"
-          elif [ "$approved" -eq 0 ]; then
-            echo "Nothing approved — standing down. The loop is inert by design."
+          elif [ "$approved" -eq 0 ] && [ "$proposals" -eq 0 ]; then
+            echo "Nothing to build — the shelf is empty. Scout will restock it."
             echo "go=false" >> "$GITHUB_OUTPUT"
           else
             echo "go=true" >> "$GITHUB_OUTPUT"
@@ -52,18 +74,27 @@ jobs:
         uses: anthropics/claude-code-action@v1
         with:
           claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
+          show_full_output: true
           claude_args: |
             --model opus
             --max-turns 80
-            --allowedTools "Bash(gh:*),Bash(git:*),Bash(npm:*),Bash(npx:*),Bash(node:*)"
+            --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
           prompt: |
-            You are the nightly BUILDER for \${{ github.repository }}.
+            You are the BUILDER for \${{ github.repository }}. You open exactly ONE pull request
+            this run, then stop.
 
             Read CLAUDE.md and LEARNINGS.md before writing a single line. LEARNINGS.md is the
             record of mistakes this loop has already made — do not repeat them.
 
-            PICK: take the OLDEST open issue labeled \`approved\`. Only that one. Never invent
-            your own work; the owner decides what gets built.
+            PICK — in this strict order:
+            1. The OLDEST open issue labeled \`approved\`. The owner asked for it; it always wins.
+            2. If none are approved, choose the SINGLE strongest open issue labeled \`proposal\` —
+               judge by value to the product against effort and risk, and prefer small. You are
+               trusted to choose. Do not ask, do not build more than one.
+            3. If neither exists, stop without opening a PR.
+
+            Comment on the issue you picked saying you have started, so a later run does not
+            pick it up too.
 
             PLAN: restate the issue as an explicit acceptance checklist before coding.
 
@@ -90,5 +121,8 @@ jobs:
               3. How to check it works — click by click
               4. What could break
 
+            The owner can only review so much. A PR he cannot understand in two minutes on his
+            phone is a PR that rots in the queue and blocks every build behind it.
+
             Never push to main. Never merge your own PR. Never report tests green that you did
             not watch pass.`,
        additions: 50,
        deletions: 16,
      },
      {
        filename: ".github/workflows/claude-mention.yml",
        patch: `@@ -37,5 +37,5 @@ jobs:
           claude_args: |
             --model opus
             --max-turns 40
-            --allowedTools "Bash(gh:*),Bash(git:*),Bash(npm:*),Bash(npx:*),Bash(node:*)"
+            --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
             --append-system-prompt "The person you are replying to is NON-TECHNICAL and is reading on a phone. Answer in plain English, short paragraphs, no jargon. If you changed code, push a claude/ branch and open a PR — never push to main. Read LEARNINGS.md before you start and obey it."`,
        additions: 1,
        deletions: 1,
      },
      {
        filename: ".github/workflows/claude-retro.yml",
        patch: `@@ -33,7 +33,7 @@ jobs:
           claude_args: |
             --model opus
             --max-turns 50
-            --allowedTools "Bash(gh:*),Bash(git:*)"
+            --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
           prompt: |
             You are the RETRO for \${{ github.repository }}'s autonomous improvement loop.
             You improve the loop itself. You do not touch product code.`,
        additions: 1,
        deletions: 1,
      },
      {
        filename: ".github/workflows/claude-scout.yml",
        patch: `@@ -1,15 +1,19 @@
 name: Claude — Scout (finds work worth doing)
 
-# Mondays 6am ET. Researches the market + the codebase, then files up to 5 issues
-# labeled \`proposal\`. It NEVER writes code. You triage from your phone: add the
-# \`approved\` label to what you want, close the rest. That is the only manual step
-# in the whole system, and it is the one that keeps you in control.
+# Runs every hour. Researches the market + the codebase, then files issues labeled
+# \`proposal\`. It NEVER writes code — it only stocks the shelf that the Builder picks
+# from. A cheap bash gate keeps the pool at 8 open proposals, so most hourly runs
+# cost ~15 seconds and never boot an agent.
 
 on:
   schedule:
-    - cron: "0 10 * * 1" # Mondays 06:00 America/New_York
+    - cron: "0 * * * *" # every hour
   workflow_dispatch:
 
+concurrency:
+  group: scout-\${{ github.repository }}
+  cancel-in-progress: false
+
 jobs:
   scout:
     runs-on: ubuntu-latest
@@ -21,41 +25,73 @@ jobs:
     steps:
       - uses: actions/checkout@v6
 
-      - uses: anthropics/claude-code-action@v1
+      # Cheap pre-flight in plain bash so we never boot an expensive agent for nothing.
+      - name: Check the proposal pool
+        id: gate
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: |
+          pool=$(gh issue list --state open --label proposal --json number --jq 'length')
+          echo "Open proposals: $pool"
+          if [ "$pool" -ge 8 ]; then
+            echo "Pool is full — standing down. An unread queue is noise, not a backlog."
+            echo "go=false" >> "$GITHUB_OUTPUT"
+          else
+            echo "go=true" >> "$GITHUB_OUTPUT"
+          fi
+          echo "pool=$pool" >> "$GITHUB_OUTPUT"
+
+      - if: steps.gate.outputs.go == 'true'
+        uses: anthropics/claude-code-action@v1
         with:
           claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
+          show_full_output: true
           claude_args: |
             --model opus
             --max-turns 50
-            --allowedTools "Bash(gh:*),Bash(git:*)"
+            --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
           prompt: |
-            You are the weekly SCOUT for \${{ github.repository }}. You never write or change
-            code. You find work that is worth doing, and you make the case for it.
+            You are the SCOUT for \${{ github.repository }}. You never write or change code.
+            You find work that is worth doing, and you make the case for it.
 
-            BACKPRESSURE FIRST: run \`gh issue list --state open --label proposal\`. If 8 or more
-            proposals are already open and untriaged, file NOTHING. Comment on the newest one
-            asking the owner to triage, and stop. An unread queue is not a backlog, it is noise.
+            There are currently \${{ steps.gate.outputs.pool }} open proposals. The pool caps at 8.
+            File at most \${{ 8 - fromJSON(steps.gate.outputs.pool) }} new issues — fewer if you
+            only found fewer things genuinely worth doing.
 
-            Otherwise:
             1. Read the codebase and CLAUDE.md to understand what this product actually is and
-               where it is weakest.
+               where it is weakest. Read LEARNINGS.md — it is the record of mistakes this loop
+               has already made.
             2. Read LOOP-DASHBOARD.md if it exists — it shows which past proposals the owner
                approved and which he ignored. Propose more of what he approves, less of what he
                ignores. This is how you get better at your job.
-            3. Use the Task tool to spawn FOUR researchers IN PARALLEL:
+            3. Read every open issue already labeled \`proposal\`
+               (\`gh issue list --state open --label proposal\`). NEVER duplicate one.
+            4. Use the Task tool to spawn FOUR researchers IN PARALLEL:
                - Competitors: who else does this, what do they have that we don't.
                - Users: what do people complain about in this category (forums, reviews).
                - Codebase: what is fragile, untested, or half-finished in our own code.
                - Revenue: what would plausibly make this product money or save it money.
-            4. File AT MOST 5 issues, each labeled \`proposal\`
-               (\`gh issue create --label proposal\`). Each one must have:
+            5. File each proposal with \`gh issue create --label proposal\`. Each one must have:
                - A plain-English title a non-technical owner instantly understands
                - What to build, and why it matters to the product's success
                - Evidence: links, quotes, or a specific file that proves the problem is real
                - Effort estimate: S / M / L
                - A one-line "how we'd know it worked"
-            5. Never duplicate an existing open issue.
 
-            Fewer, better proposals beat five mediocre ones. If you only found two things worth
-            doing this week, file two. Filing five weak ideas to look productive is the exact
+            The Builder picks the best proposal off this shelf on its own — it does not wait for
+            the owner. So a weak proposal is not harmless: it becomes a real PR that wastes the
+            owner's review time. Fewer, better proposals win. If you found nothing worth doing
+            this hour, file NOTHING and say so. Filing filler to look productive is the exact
             failure mode that kills this system.
+
+      # A green tick does not mean the task succeeded. Prove it.
+      - name: Verify Scout actually filed something
+        if: steps.gate.outputs.go == 'true'
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: |
+          now=$(gh issue list --state open --label proposal --json number --jq 'length')
+          echo "Open proposals: \${{ steps.gate.outputs.pool }} before → $now after"
+          if [ "$now" -le "\${{ steps.gate.outputs.pool }}" ]; then
+            echo "::warning::Scout filed nothing this run. Fine if it found nothing; check the log above for permission denials if this repeats."
+          fi`,
        additions: 56,
        deletions: 20,
      },
    ],
  },
  "559657f5a3013ebb9f5052cd0cc63257b058e291": {
    message: "Fix: allow agents to actually use gh/git (loop was silently no-op) (#10)",
    files: [
      {
        filename: ".github/workflows/claude-audit.yml",
        patch: `@@ -34,6 +34,7 @@ jobs:
           claude_args: |
             --model opus
             --max-turns 60
+            --allowedTools "Bash(gh:*),Bash(git:*),Bash(npm:*),Bash(npx:*),Bash(node:*)"
           prompt: |
             You are the ADVERSARIAL AUDITOR for PR #\${{ github.event.pull_request.number }}
             in \${{ github.repository }}. Your job is to find reasons this PR should NOT be`,
        additions: 1,
        deletions: 0,
      },
      {
        filename: ".github/workflows/claude-builder.yml",
        patch: `@@ -55,6 +55,7 @@ jobs:
           claude_args: |
             --model opus
             --max-turns 80
+            --allowedTools "Bash(gh:*),Bash(git:*),Bash(npm:*),Bash(npx:*),Bash(node:*)"
           prompt: |
             You are the nightly BUILDER for \${{ github.repository }}.
 `,
        additions: 1,
        deletions: 0,
      },
      {
        filename: ".github/workflows/claude-mention.yml",
        patch: `@@ -37,4 +37,5 @@ jobs:
           claude_args: |
             --model opus
             --max-turns 40
+            --allowedTools "Bash(gh:*),Bash(git:*),Bash(npm:*),Bash(npx:*),Bash(node:*)"
             --append-system-prompt "The person you are replying to is NON-TECHNICAL and is reading on a phone. Answer in plain English, short paragraphs, no jargon. If you changed code, push a claude/ branch and open a PR — never push to main. Read LEARNINGS.md before you start and obey it."`,
        additions: 1,
        deletions: 0,
      },
      {
        filename: ".github/workflows/claude-retro.yml",
        patch: `@@ -33,6 +33,7 @@ jobs:
           claude_args: |
             --model opus
             --max-turns 50
+            --allowedTools "Bash(gh:*),Bash(git:*)"
           prompt: |
             You are the RETRO for \${{ github.repository }}'s autonomous improvement loop.
             You improve the loop itself. You do not touch product code.`,
        additions: 1,
        deletions: 0,
      },
      {
        filename: ".github/workflows/claude-scout.yml",
        patch: `@@ -27,6 +27,7 @@ jobs:
           claude_args: |
             --model opus
             --max-turns 50
+            --allowedTools "Bash(gh:*),Bash(git:*)"
           prompt: |
             You are the weekly SCOUT for \${{ github.repository }}. You never write or change
             code. You find work that is worth doing, and you make the case for it.`,
        additions: 1,
        deletions: 0,
      },
    ],
  },
  "6e9b6bde3e5bedd95ac8298261e3fb44e0840d6d": {
    message: "Autonomous improvement loop v2: audit, measure, and learn (#8)",
    files: [
      {
        filename: ".github/workflows/claude-audit.yml",
        patch: `@@ -0,0 +1,68 @@
+name: Claude — Auditor (adversarial PR review)
+
+# Every PR is torn apart by an INDEPENDENT agent before the owner ever sees it.
+# This is where tokens are deliberately spent: five parallel reviewers, each with a
+# different lens, then a verification pass that throws out anything unsubstantiated.
+# Goal: the owner should only ever be handed PRs that are actually safe to merge.
+
+on:
+  pull_request:
+    types: [opened, synchronize, reopened]
+
+# A new push supersedes an in-flight audit of the same PR — don't pay twice.
+concurrency:
+  group: audit-\${{ github.event.pull_request.number }}
+  cancel-in-progress: true
+
+jobs:
+  audit:
+    runs-on: ubuntu-latest
+    timeout-minutes: 40
+    permissions:
+      contents: read
+      pull-requests: write
+      issues: write
+      id-token: write
+    steps:
+      - uses: actions/checkout@v6
+        with:
+          fetch-depth: 0
+
+      - uses: anthropics/claude-code-action@v1
+        with:
+          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
+          claude_args: |
+            --model opus
+            --max-turns 60
+          prompt: |
+            You are the ADVERSARIAL AUDITOR for PR #\${{ github.event.pull_request.number }}
+            in \${{ github.repository }}. Your job is to find reasons this PR should NOT be
+            merged. Assume it is subtly broken until you prove otherwise.
+
+            Read LEARNINGS.md first — it lists mistakes this loop has made before. Check for
+            repeats of them specifically.
+
+            Use the Task tool to spawn FIVE reviewers IN PARALLEL, one per lens:
+              1. Correctness  — does it do what the PR claims? Trace the logic. Find the bug.
+              2. Regression   — what existing behavior breaks? Check every caller and import.
+              3. Security     — secrets, injection, authz, unsafe deps, exposed endpoints.
+              4. Tests        — is it really covered? Name the failing case this PR misses.
+              5. Simplicity   — dead code, duplication, over-engineering, style mismatch.
+
+            Then VERIFY each finding yourself before reporting it. Reproduce it in the code.
+            Discard anything you cannot pin to a specific file:line WITH a concrete failure
+            scenario. A false alarm wastes the owner's trust and is worse than a missed nit.
+
+            Run the build and the test suite. Report what you actually observed. NEVER claim
+            green if you did not see green.
+
+            Post ONE review comment on the PR, exactly this shape:
+
+              **Verdict:** SHIP / FIX FIRST / DO NOT MERGE
+              **Plain English:** 3 lines a non-technical owner can act on.
+              **Blocking issues:** numbered; each with file:line and the fix.
+              **Non-blocking:** short list.
+              **Tests:** what you ran and what happened.
+
+            If it is genuinely good, say SHIP and keep it short. Do not manufacture findings
+            to look thorough — an auditor that cries wolf gets ignored, and then it is useless.`,
        additions: 68,
        deletions: 0,
      },
      {
        filename: ".github/workflows/claude-builder.yml",
        patch: `@@ -0,0 +1,93 @@
+name: Claude — Builder (implements approved issues)
+
+# Runs nightly at 3am ET. Picks the oldest issue YOU labeled \`approved\` and builds it.
+# Two hard gates mean it costs ~1 minute and does nothing unless you have approved work,
+# so the nightly schedule is cheap.
+# You can also start it by hand: Actions tab -> this workflow -> Run workflow.
+
+on:
+  schedule:
+    - cron: "0 7 * * *" # 03:00 America/New_York
+  workflow_dispatch:
+
+concurrency:
+  group: builder-\${{ github.repository }}
+  cancel-in-progress: false
+
+jobs:
+  build:
+    runs-on: ubuntu-latest
+    timeout-minutes: 90
+    permissions:
+      contents: write
+      pull-requests: write
+      issues: write
+      id-token: write
+    steps:
+      - uses: actions/checkout@v6
+        with:
+          fetch-depth: 0
+
+      # Cheap pre-flight in plain bash so we never boot an expensive agent for nothing.
+      - name: Check the queue
+        id: gate
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: |
+          open_claude_prs=$(gh pr list --state open --json headRefName \\
+            --jq '[.[] | select(.headRefName | startswith("claude/"))] | length')
+          approved=$(gh issue list --state open --label approved --json number --jq 'length')
+          echo "Open claude/ PRs: $open_claude_prs | Approved issues waiting: $approved"
+          if [ "$open_claude_prs" -gt 0 ]; then
+            echo "An agent PR is still open — standing down (one at a time)."
+            echo "go=false" >> "$GITHUB_OUTPUT"
+          elif [ "$approved" -eq 0 ]; then
+            echo "Nothing approved — standing down. The loop is inert by design."
+            echo "go=false" >> "$GITHUB_OUTPUT"
+          else
+            echo "go=true" >> "$GITHUB_OUTPUT"
+          fi
+
+      - if: steps.gate.outputs.go == 'true'
+        uses: anthropics/claude-code-action@v1
+        with:
+          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
+          claude_args: |
+            --model opus
+            --max-turns 80
+          prompt: |
+            You are the nightly BUILDER for \${{ github.repository }}.
+
+            Read CLAUDE.md and LEARNINGS.md before writing a single line. LEARNINGS.md is the
+            record of mistakes this loop has already made — do not repeat them.
+
+            PICK: take the OLDEST open issue labeled \`approved\`. Only that one. Never invent
+            your own work; the owner decides what gets built.
+
+            PLAN: restate the issue as an explicit acceptance checklist before coding.
+
+            BUILD (spend tokens here — this is the point):
+            - Use the Task tool to spawn THREE agents in parallel, each proposing a different
+              implementation approach for this issue.
+            - Judge the three against: smallest honest diff, best fit with existing repo style,
+              easiest for a non-technical owner to verify by clicking around.
+            - Implement the winner, grafting in the best ideas from the other two.
+            - Keep the change SMALL. Large changesets are the single best predictor of
+              breakage. If the issue is genuinely big, implement the smallest useful slice and
+              say in the PR what you deliberately left out.
+            - Write or update tests for what you changed.
+
+            VERIFY: run the build and the full test suite. They must pass. If they do not pass
+            after honest effort, do NOT open a PR — comment on the issue explaining exactly what
+            blocked you, in plain English, and stop. A blocked run that says so is a success.
+            A green-looking broken PR is a failure.
+
+            SHIP: open ONE pull request from a \`claude/\` branch with \`Closes #<issue>\` in the
+            body. Write the description for a NON-TECHNICAL owner reading on a phone:
+              1. What changed
+              2. Why it matters
+              3. How to check it works — click by click
+              4. What could break
+
+            Never push to main. Never merge your own PR. Never report tests green that you did
+            not watch pass.`,
        additions: 93,
        deletions: 0,
      },
      {
        filename: ".github/workflows/claude-mention.yml",
        patch: `@@ -0,0 +1,40 @@
+name: Claude — @mention (phone remote control)
+
+# Type "@claude <anything>" in any issue or PR comment — from the GitHub mobile app —
+# and an agent wakes up in the cloud, does the work, and replies or pushes a branch.
+# This is the on-demand half of the system. Billed to the Max subscription, not the API.
+
+on:
+  issue_comment:
+    types: [created]
+  pull_request_review_comment:
+    types: [created]
+  issues:
+    types: [opened]
+
+jobs:
+  claude:
+    if: |
+      contains(github.event.comment.body, '@claude') ||
+      contains(github.event.issue.body, '@claude')
+    runs-on: ubuntu-latest
+    timeout-minutes: 45
+    permissions:
+      contents: write
+      pull-requests: write
+      issues: write
+      id-token: write
+      actions: read
+    steps:
+      - uses: actions/checkout@v6
+        with:
+          fetch-depth: 0
+
+      - uses: anthropics/claude-code-action@v1
+        with:
+          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
+          track_progress: true
+          claude_args: |
+            --model opus
+            --max-turns 40
+            --append-system-prompt "The person you are replying to is NON-TECHNICAL and is reading on a phone. Answer in plain English, short paragraphs, no jargon. If you changed code, push a claude/ branch and open a PR — never push to main. Read LEARNINGS.md before you start and obey it."`,
        additions: 40,
        deletions: 0,
      },
      {
        filename: ".github/workflows/claude-retro.yml",
        patch: `@@ -0,0 +1,74 @@
+name: Claude — Retro (the loop improves itself)
+
+# Sundays 6pm ET. Reads the week's ACTUAL outcomes — what you merged, what you threw
+# away, what you ignored — and proposes changes to how the agents work.
+#
+# This is the self-improvement loop, and it is deliberately kept on a leash: the retro
+# can only PROPOSE. It opens a PR against LEARNINGS.md and the workflow prompts; you
+# merge it or you don't. An agent allowed to silently rewrite its own instructions can
+# silently delete the guardrail that was protecting you.
+
+on:
+  schedule:
+    - cron: "0 22 * * 0" # Sundays 18:00 America/New_York
+  workflow_dispatch:
+
+jobs:
+  retro:
+    runs-on: ubuntu-latest
+    timeout-minutes: 45
+    permissions:
+      contents: write
+      pull-requests: write
+      issues: write
+      id-token: write
+    steps:
+      - uses: actions/checkout@v6
+        with:
+          fetch-depth: 0
+
+      - uses: anthropics/claude-code-action@v1
+        with:
+          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
+          claude_args: |
+            --model opus
+            --max-turns 50
+          prompt: |
+            You are the RETRO for \${{ github.repository }}'s autonomous improvement loop.
+            You improve the loop itself. You do not touch product code.
+
+            LOOK AT WHAT ACTUALLY HAPPENED in the last 7 days. Use \`gh\`:
+            - PRs from \`claude/\` branches: which merged, which the owner closed unmerged,
+              which he asked for changes on, and WHAT he said in the comments. His comments
+              are the highest-value signal in this entire system — read every one.
+            - Issues labeled \`proposal\`: which he approved, which he ignored or closed.
+              What do the approved ones have in common? What do the ignored ones have in common?
+            - Failed or blocked agent runs (\`gh run list --status failure\`).
+            - Read metrics/loop-metrics.json for the trend, not just this week's snapshot.
+
+            DIAGNOSE HONESTLY. The failure mode you are hunting for is the loop producing
+            volume that looks like progress. Specifically flag it if:
+            - merge rate is falling while PR count rises,
+            - median PR size is climbing,
+            - proposals are being ignored rather than approved or closed,
+            - the same mistake shows up in more than one PR.
+            If the loop did nothing useful this week, SAY THAT. A retro that always finds
+            things going well is worthless.
+
+            THEN DO TWO THINGS:
+
+            1. Open ONE issue titled "[retro] Week of <date>":
+               - 5 lines, plain English, what the loop actually accomplished (or didn't)
+               - The single biggest problem with the loop right now
+               - At most 3 concrete fixes
+
+            2. If — and only if — the week produced a real, repeated lesson (a PR closed for
+               a reason that will recur, a mistake made twice), open ONE pull request that:
+               - appends 1–3 dated lines to LEARNINGS.md, and/or
+               - edits the prompt inside a .github/workflows/claude-*.yml file
+               Keep LEARNINGS.md under 50 lines. Prune stale entries in the same PR. Learn
+               ONLY from failures and corrections — a file full of self-congratulation is
+               worse than no file, because it dilutes the context every future agent loads.
+
+            If there is no real lesson, open no PR. Most weeks should produce no PR. Inventing
+            a lesson to look useful is the failure this retro exists to catch.`,
        additions: 74,
        deletions: 0,
      },
      {
        filename: ".github/workflows/claude-scout.yml",
        patch: `@@ -0,0 +1,60 @@
+name: Claude — Scout (finds work worth doing)
+
+# Mondays 6am ET. Researches the market + the codebase, then files up to 5 issues
+# labeled \`proposal\`. It NEVER writes code. You triage from your phone: add the
+# \`approved\` label to what you want, close the rest. That is the only manual step
+# in the whole system, and it is the one that keeps you in control.
+
+on:
+  schedule:
+    - cron: "0 10 * * 1" # Mondays 06:00 America/New_York
+  workflow_dispatch:
+
+jobs:
+  scout:
+    runs-on: ubuntu-latest
+    timeout-minutes: 45
+    permissions:
+      contents: read
+      issues: write
+      id-token: write
+    steps:
+      - uses: actions/checkout@v6
+
+      - uses: anthropics/claude-code-action@v1
+        with:
+          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
+          claude_args: |
+            --model opus
+            --max-turns 50
+          prompt: |
+            You are the weekly SCOUT for \${{ github.repository }}. You never write or change
+            code. You find work that is worth doing, and you make the case for it.
+
+            BACKPRESSURE FIRST: run \`gh issue list --state open --label proposal\`. If 8 or more
+            proposals are already open and untriaged, file NOTHING. Comment on the newest one
+            asking the owner to triage, and stop. An unread queue is not a backlog, it is noise.
+
+            Otherwise:
+            1. Read the codebase and CLAUDE.md to understand what this product actually is and
+               where it is weakest.
+            2. Read LOOP-DASHBOARD.md if it exists — it shows which past proposals the owner
+               approved and which he ignored. Propose more of what he approves, less of what he
+               ignores. This is how you get better at your job.
+            3. Use the Task tool to spawn FOUR researchers IN PARALLEL:
+               - Competitors: who else does this, what do they have that we don't.
+               - Users: what do people complain about in this category (forums, reviews).
+               - Codebase: what is fragile, untested, or half-finished in our own code.
+               - Revenue: what would plausibly make this product money or save it money.
+            4. File AT MOST 5 issues, each labeled \`proposal\`
+               (\`gh issue create --label proposal\`). Each one must have:
+               - A plain-English title a non-technical owner instantly understands
+               - What to build, and why it matters to the product's success
+               - Evidence: links, quotes, or a specific file that proves the problem is real
+               - Effort estimate: S / M / L
+               - A one-line "how we'd know it worked"
+            5. Never duplicate an existing open issue.
+
+            Fewer, better proposals beat five mediocre ones. If you only found two things worth
+            doing this week, file two. Filing five weak ideas to look productive is the exact
+            failure mode that kills this system.`,
        additions: 60,
        deletions: 0,
      },
      {
        filename: ".github/workflows/loop-metrics.yml",
        patch: `@@ -0,0 +1,44 @@
+name: Loop — Metrics
+
+# Pure bash + node. No agent, no tokens, ~30 seconds a day.
+# Recomputes the loop's scorecard from GitHub's own record and commits it.
+# Also runs immediately whenever a PR is merged or closed, so the dashboard is never stale.
+
+on:
+  schedule:
+    - cron: "0 11 * * *" # 07:00 America/New_York, before you look at your phone
+  pull_request:
+    types: [closed]
+  workflow_dispatch:
+
+permissions:
+  contents: write
+  pull-requests: read
+  issues: read
+
+jobs:
+  metrics:
+    runs-on: ubuntu-latest
+    timeout-minutes: 5
+    steps:
+      - uses: actions/checkout@v6
+        with:
+          ref: main
+
+      - uses: actions/setup-node@v4
+        with:
+          node-version: "20"
+
+      - name: Recompute the scorecard
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: node scripts/loop-metrics.mjs
+
+      - name: Commit if it changed
+        run: |
+          git config user.name  "github-actions[bot]"
+          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
+          git add metrics/loop-metrics.json LOOP-DASHBOARD.md
+          git diff --staged --quiet && echo "No change." && exit 0
+          git commit -m "chore(loop): update metrics dashboard [skip ci]"
+          git push`,
        additions: 44,
        deletions: 0,
      },
    ],
  },
  "91a814cbe0fbd4f0371b9ff738f451b6b60f4bec": {
    message: "Security: gate the @mention agent behind a permission check",
    files: [
      {
        filename: ".github/workflows/claude-mention.yml",
        patch: `@@ -13,11 +13,66 @@ on:
     types: [opened]
 
 jobs:
-  claude:
+  # WHO IS ALLOWED TO STEER THIS AGENT.
+  # This repository is PUBLIC. Without this gate, the \`@claude\` trigger below is open to
+  # every GitHub account on earth: anyone could comment "@claude ..." on any issue and get
+  # an agent with Bash, Write, WebFetch, \`contents: write\` and \`actions: write\` running
+  # against this repo. That is arbitrary code execution by a stranger, not a mention.
+  #
+  # LEARNINGS.md line 18 concluded that plain \`Bash\` was acceptable "in an ephemeral CI
+  # container on a PRIVATE repo". That reasoning was correct when it was written. The repo
+  # later went public and this control never followed — so the gate goes here now, and the
+  # note in LEARNINGS.md is no longer a justification for leaving it off.
+  #
+  # Same fail-closed check as claude-redraft.yml: ask the API what this person can actually
+  # do here, accept only ADMIN or MAINTAIN, refuse identities that cannot be checked, and
+  # do it in a separate \`contents: read\` job so the permission lookup never runs alongside
+  # write access. If the permission cannot be read, the run does not proceed.
+  authorize:
     if: |
       contains(github.event.comment.body, '@claude') ||
       contains(github.event.issue.body, '@claude')
     runs-on: ubuntu-latest
+    timeout-minutes: 5
+    permissions:
+      contents: read
+    outputs:
+      ok: \${{ steps.check.outputs.ok }}
+    steps:
+      - name: Is the person who mentioned @claude allowed to steer the agent?
+        id: check
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+          REPO: \${{ github.repository }}
+          SENDER: \${{ github.event.sender.login }}
+        run: |
+          # A login is letters, digits and hyphens. Anything else (notably a \`name[bot]\`
+          # App identity) is not a person we can check, so it is not authorized.
+          case "$SENDER" in
+            '' | *[!A-Za-z0-9-]*)
+              echo "::notice::'@claude' was mentioned by '$SENDER', which is not a plain user account (App and bot identities cannot be permission-checked). Not running."
+              echo "ok=false" >> "$GITHUB_OUTPUT"
+              exit 0
+              ;;
+          esac
+
+          perm=$(gh api "repos/$REPO/collaborators/$SENDER/permission" --jq '.permission' 2>/dev/null || echo "")
+          echo "Permission of '$SENDER' on $REPO: \${perm:-(could not be read)}"
+          case "$perm" in
+            admin | maintain)
+              echo "Authorized — '$SENDER' is a repository $perm."
+              echo "ok=true" >> "$GITHUB_OUTPUT"
+              ;;
+            *)
+              echo "::notice::Ignoring the '@claude' mention from '$SENDER' (permission: \${perm:-none, or not readable}). Only repository admins and maintainers can steer this agent."
+              echo "ok=false" >> "$GITHUB_OUTPUT"
+              ;;
+          esac
+
+  claude:
+    needs: authorize
+    if: needs.authorize.outputs.ok == 'true'
+    runs-on: ubuntu-latest
     timeout-minutes: 45
     permissions:
       # Required by anthropics/claude-code-action: it mints its GitHub App token from OIDC.`,
        additions: 56,
        deletions: 1,
      },
    ],
  },
  "a94abd9bd1bbcbddfc97442be3a5610d59a2683d": {
    message: "loop-config: re-trigger Auditor/Demo/Tests after an @mention pushes a follow-up fix to an existing PR (GITHUB_TOKEN pushes don't cascade pull_request:synchronize, so the old verdict was staying stale forever)",
    files: [
      {
        filename: ".github/workflows/claude-mention.yml",
        patch: `@@ -24,12 +24,36 @@ jobs:
       pull-requests: write
       issues: write
       id-token: write
-      actions: read
+      actions: write
     steps:
       - uses: actions/checkout@v6
         with:
           fetch-depth: 0
 
+      # If this mention is happening on an existing PR (not a plain issue), note where
+      # its branch is RIGHT NOW so we can tell afterward whether the agent actually
+      # pushed something — see "Re-check the PR" below for why that matters.
+      - name: Resolve PR context
+        id: pr
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: |
+          if [ "\${{ github.event_name }}" = "pull_request_review_comment" ]; then
+            pr="\${{ github.event.pull_request.number }}"
+          elif [ "\${{ github.event_name }}" = "issue_comment" ] && [ -n "\${{ github.event.issue.pull_request.url }}" ]; then
+            pr="\${{ github.event.issue.number }}"
+          else
+            pr=""
+          fi
+          echo "pr_number=$pr" >> "$GITHUB_OUTPUT"
+          if [ -n "$pr" ]; then
+            before=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
+            echo "before_sha=$before" >> "$GITHUB_OUTPUT"
+            echo "Mention is on PR #$pr, currently at $before"
+          else
+            echo "Mention is not on an existing PR — nothing to re-check afterward."
+          fi
+
       - uses: anthropics/claude-code-action@v1
         with:
           claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
@@ -39,3 +63,28 @@ jobs:
             --max-turns 40
             --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
             --append-system-prompt "The person you are replying to is NON-TECHNICAL and is reading on a phone. Answer in plain English, short paragraphs, no jargon. If you changed code, push a claude/ branch and open a PR — never push to main. Read LEARNINGS.md before you start and obey it. If the owner asks you to change what an issue should cover, EDIT THE ISSUE BODY to match — do not just reply in a comment. The Builder plans from the body, so scope changes that live only in a comment can be missed."
+
+      # This agent's push uses the default GITHUB_TOKEN identity, which GitHub's own
+      # recursion-prevention rule silently excludes from ever triggering
+      # \`pull_request: synchronize\` — so the Auditor, Demo, and plain-CI tests would
+      # otherwise never re-run after a follow-up fix lands on an existing PR, leaving
+      # a stale verdict on screen forever even though the code actually changed.
+      # workflow_dispatch is explicitly exempt from that rule, so trigger it by hand,
+      # and only when something on the PR's branch actually moved.
+      - name: Re-check the PR if this mention pushed a new commit to it
+        if: steps.pr.outputs.pr_number != ''
+        env:
+          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
+        run: |
+          pr="\${{ steps.pr.outputs.pr_number }}"
+          before="\${{ steps.pr.outputs.before_sha }}"
+          after_sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
+          after_ref=$(gh pr view "$pr" --json headRefName --jq .headRefName)
+          if [ "$after_sha" = "$before" ]; then
+            echo "No new commit on PR #$pr — nothing to re-check."
+            exit 0
+          fi
+          echo "PR #$pr moved $before -> $after_sha — re-triggering the review pipeline."
+          gh workflow run claude-audit.yml --ref main -f pr_number="$pr" || echo "::warning::Couldn't queue a re-audit."
+          gh workflow run claude-demo.yml --ref main -f pr_number="$pr" || echo "::warning::Couldn't queue a re-demo."
+          gh workflow run repo-tests.yml --ref "$after_ref" || echo "::warning::Couldn't queue a re-test."`,
        additions: 50,
        deletions: 1,
      },
    ],
  },
  "0443cd32c0da3398e9559b48015cbbf2707e04b4": {
    message: "Builder: start on approval, never build the same issue twice, read the comments (#33)",
    files: [
      {
        filename: ".github/workflows/claude-builder.yml",
        patch: `@@ -1,7 +1,13 @@
 name: Claude — Builder (implements work, keeps your queue full)
 
-# Runs every 30 minutes. Opens ONE pull request per run, and only if your review queue
-# has room.
+# Runs the moment you label an issue \`approved\`, and every 30 minutes as a backstop.
+# Opens ONE pull request per run, and only if your review queue has room.
+#
+# WHY THE \`labeled\` TRIGGER: GitHub's cron is best-effort and silently drops runs under
+# load — this */30 schedule really fired at 14:02, 15:59, 16:51, 17:24, 18:42 on
+# 2026-07-14. The owner approved three issues and watched nothing happen for an hour,
+# because the Builder simply never woke up. Now approving from the phone starts a build
+# within a minute, and the schedule is only a safety net.
 #
 # THE QUEUE RULE:
 #   - Daytime (7am–11pm ET): at most 3 agent PRs may be open and waiting on you at once.
@@ -12,12 +18,15 @@ name: Claude — Builder (implements work, keeps your queue full)
 #   - An issue you labeled \`approved\` always jumps the queue and gets built first.
 #   - Otherwise it picks the strongest open \`proposal\` on its own. You do not have to
 #     approve anything for the loop to keep moving.
+#   - It NEVER picks an issue that already has an open \`claude/\` PR against it.
 #
 # A cheap bash gate runs first, so a run with no room and no work costs ~15 seconds.
 
 on:
+  issues:
+    types: [labeled]
   schedule:
-    - cron: "*/30 * * * *" # every 30 minutes
+    - cron: "*/30 * * * *" # backstop only — GitHub drops these regularly
   workflow_dispatch:
 
 concurrency:
@@ -26,6 +35,8 @@ concurrency:
 
 jobs:
   build:
+    # On a label event, only wake up for \`approved\` — not for every label anyone adds.
+    if: github.event_name != 'issues' || github.event.label.name == 'approved'
     runs-on: ubuntu-latest
     timeout-minutes: 90
     permissions:
@@ -56,9 +67,23 @@ jobs:
 
           open_prs=$(gh pr list --state open --json headRefName \\
             --jq '[.[] | select(.headRefName | startswith("claude/"))] | length')
+
+          # Issues that an OPEN agent PR already claims (via "Closes #N" in its body).
+          # Without this the Builder rebuilds an issue it is already building: on
+          # 2026-07-14 two runs both picked issue #15, both spent ~14 minutes, and
+          # produced two PRs for one feature. Telling the agent "I've started this" in
+          # an issue comment is NOT protection — the next run never reads it. This is.
+          claimed=$(gh pr list --state open --json headRefName,body \\
+            --jq '[.[] | select(.headRefName | startswith("claude/"))
+                       | (.body // "") | scan("(?i)closes #([0-9]+)") | .[0]]
+                  | unique | join(", ")')
+          [ -z "$claimed" ] && claimed="(none)"
+
           approved=$(gh issue list --state open --label approved --json number --jq 'length')
           proposals=$(gh issue list --state open --label proposal --json number --jq 'length')
           echo "Agent PRs awaiting you: $open_prs / $cap | approved: $approved | proposals: $proposals"
+          echo "Already claimed by an open PR: $claimed"
+          echo "claimed=$claimed" >> "$GITHUB_OUTPUT"
 
           if [ "$open_prs" -ge "$cap" ]; then
             echo "Your review queue is full — standing down. Merge or close one to free a slot."
@@ -105,17 +130,39 @@ jobs:
             that.
             ────────────────────────────────────────────────────────────────────────
 
-            PICK — in this strict order:
+            ────────────────────────────────────────────────────────────────────────
+            NEVER BUILD AN ISSUE THAT IS ALREADY BEING BUILT
+
+            These issues already have an OPEN pull request against them:
+                \${{ steps.gate.outputs.claimed }}
+
+            They are OFF LIMITS. Do not pick them. Do not "improve" them.
+
+            This happened for real on 2026-07-14: two Builder runs both picked issue #15, both
+            spent fourteen minutes, and produced two pull requests for one feature. The owner
+            had to throw one away. Commenting "I've started this" on the issue is NOT enough
+            protection, because the next run does not read it — this list is the protection.
+            ────────────────────────────────────────────────────────────────────────
+
+            PICK — in this strict order, skipping anything in the off-limits list above:
             1. The OLDEST open issue labeled \`approved\`. The owner asked for it; it always wins.
             2. If none are approved, choose the SINGLE strongest open issue labeled \`proposal\` —
                judge by value to the product against effort and risk, and prefer small. You are
                trusted to choose. Do not ask, do not build more than one.
             3. If neither exists, stop without opening a PR.
 
-            Comment on the issue you picked saying you have started, so a later run does not
-            pick it up too.
+            READ THE WHOLE CONVERSATION, NOT JUST THE ISSUE BODY:
+            run \`gh issue view <n> --comments\`. The owner often clarifies, narrows, or changes
+            his mind in the comments — "only do the YouTube part", "skip the migration", "keep
+            it small". **His comments OVERRIDE the original issue body.** Building the body while
+            ignoring a comment that contradicts it means building the wrong thing. If a comment
+            genuinely conflicts with the body and you cannot tell which he means, build the
+            SMALLER interpretation and say so in the PR.
+
+            Comment on the issue you picked saying you have started, so a human watching knows.
 
-            PLAN: restate the issue as an explicit acceptance checklist before coding.
+            PLAN: restate the issue — as amended by the comments — as an explicit acceptance
+            checklist before coding.
 
             BUILD (spend tokens here — this is the point):
             - Spawn THREE agents with the Task tool, in ONE message, each with`,
        additions: 54,
        deletions: 7,
      },
      {
        filename: ".github/workflows/claude-mention.yml",
        patch: `@@ -38,4 +38,4 @@ jobs:
             --model opus
             --max-turns 40
             --allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebSearch,WebFetch"
-            --append-system-prompt "The person you are replying to is NON-TECHNICAL and is reading on a phone. Answer in plain English, short paragraphs, no jargon. If you changed code, push a claude/ branch and open a PR — never push to main. Read LEARNINGS.md before you start and obey it."
+            --append-system-prompt "The person you are replying to is NON-TECHNICAL and is reading on a phone. Answer in plain English, short paragraphs, no jargon. If you changed code, push a claude/ branch and open a PR — never push to main. Read LEARNINGS.md before you start and obey it. If the owner asks you to change what an issue should cover, EDIT THE ISSUE BODY to match — do not just reply in a comment. The Builder plans from the body, so scope changes that live only in a comment can be missed."`,
        additions: 1,
        deletions: 1,
      },
    ],
  },
};

const DEFAULT_COMMIT_DIFF: CommitDiffBody =
  COMMIT_DIFFS["ae799942b906126975fa51af80e6bfc87295f743"]!;

/* ------------------------------------------------------------------ */
/* 7. testing/runs — the fifteen most recent runs, any workflow        */
/* ------------------------------------------------------------------ */

const GENERAL_RUNS: RunSummary[] = [
  {
    id: 33912732448,
    name: "Claude — Builder (implements work, keeps your queue full)",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T19:44:48Z",
    updatedAt: "2026-09-04T19:46:02Z",
    runStartedAt: "2026-09-04T19:44:48Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33912732448",
    event: "schedule",
    displayName: "Claude — Builder (implements work, keeps your queue full)",
  },
  {
    id: 33900734875,
    name: "Claude — Scout (finds work worth doing)",
    workflowFile: "claude-scout.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T17:28:08Z",
    updatedAt: "2026-09-04T17:28:23Z",
    runStartedAt: "2026-09-04T17:28:08Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33900734875",
    event: "schedule",
    displayName: "Claude — Scout (finds work worth doing)",
  },
  {
    id: 33899958637,
    name: "Claude — Builder (implements work, keeps your queue full)",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T17:19:31Z",
    updatedAt: "2026-09-04T17:20:28Z",
    runStartedAt: "2026-09-04T17:19:31Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33899958637",
    event: "schedule",
    displayName: "Claude — Builder (implements work, keeps your queue full)",
  },
  {
    id: 33885201689,
    name: "Loop — Metrics",
    workflowFile: "loop-metrics.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T14:41:35Z",
    updatedAt: "2026-09-04T14:41:58Z",
    runStartedAt: "2026-09-04T14:41:35Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33885201689",
    event: "schedule",
    displayName: "Loop — Metrics",
  },
  {
    id: 33880731192,
    name: "Claude — Builder (implements work, keeps your queue full)",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T13:55:08Z",
    updatedAt: "2026-09-04T13:56:34Z",
    runStartedAt: "2026-09-04T13:55:08Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33880731192",
    event: "schedule",
    displayName: "Claude — Builder (implements work, keeps your queue full)",
  },
  {
    id: 33877319005,
    name: "Claude — Scout (finds work worth doing)",
    workflowFile: "claude-scout.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T13:18:21Z",
    updatedAt: "2026-09-04T13:18:35Z",
    runStartedAt: "2026-09-04T13:18:21Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33877319005",
    event: "schedule",
    displayName: "Claude — Scout (finds work worth doing)",
  },
  {
    id: 33860117324,
    name: "Claude — Builder (implements work, keeps your queue full)",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T09:47:59Z",
    updatedAt: "2026-09-04T09:49:04Z",
    runStartedAt: "2026-09-04T09:47:59Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33860117324",
    event: "schedule",
    displayName: "Claude — Builder (implements work, keeps your queue full)",
  },
  {
    id: 33854559992,
    name: "Claude — Scout (finds work worth doing)",
    workflowFile: "claude-scout.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T08:40:21Z",
    updatedAt: "2026-09-04T08:40:36Z",
    runStartedAt: "2026-09-04T08:40:21Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33854559992",
    event: "schedule",
    displayName: "Claude — Scout (finds work worth doing)",
  },
  {
    id: 33840078731,
    name: "Claude — Builder (implements work, keeps your queue full)",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T05:19:43Z",
    updatedAt: "2026-09-04T05:20:50Z",
    runStartedAt: "2026-09-04T05:19:43Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33840078731",
    event: "schedule",
    displayName: "Claude — Builder (implements work, keeps your queue full)",
  },
  {
    id: 33834291216,
    name: "Claude — Scout (finds work worth doing)",
    workflowFile: "claude-scout.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T03:44:17Z",
    updatedAt: "2026-09-04T03:44:28Z",
    runStartedAt: "2026-09-04T03:44:17Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33834291216",
    event: "schedule",
    displayName: "Claude — Scout (finds work worth doing)",
  },
  {
    id: 33822491026,
    name: "Claude — Builder (implements work, keeps your queue full)",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-04T00:36:40Z",
    updatedAt: "2026-09-04T00:38:02Z",
    runStartedAt: "2026-09-04T00:36:40Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33822491026",
    event: "schedule",
    displayName: "Claude — Builder (implements work, keeps your queue full)",
  },
  {
    id: 33816043859,
    name: "Claude — Scout (finds work worth doing)",
    workflowFile: "claude-scout.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-03T23:05:26Z",
    updatedAt: "2026-09-03T23:05:41Z",
    runStartedAt: "2026-09-03T23:05:26Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33816043859",
    event: "schedule",
    displayName: "Claude — Scout (finds work worth doing)",
  },
  {
    id: 33814216516,
    name: "Claude — Builder (implements work, keeps your queue full)",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-03T22:41:11Z",
    updatedAt: "2026-09-03T22:42:21Z",
    runStartedAt: "2026-09-03T22:41:11Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33814216516",
    event: "schedule",
    displayName: "Claude — Builder (implements work, keeps your queue full)",
  },
  {
    id: 33804004615,
    name: "Claude — Scout (finds work worth doing)",
    workflowFile: "claude-scout.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-03T20:44:23Z",
    updatedAt: "2026-09-03T20:44:40Z",
    runStartedAt: "2026-09-03T20:44:23Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33804004615",
    event: "schedule",
    displayName: "Claude — Scout (finds work worth doing)",
  },
  {
    id: 33799729772,
    name: "Claude — Builder (implements work, keeps your queue full)",
    workflowFile: "claude-builder.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-03T20:00:32Z",
    updatedAt: "2026-09-03T20:01:41Z",
    runStartedAt: "2026-09-03T20:00:32Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33799729772",
    event: "schedule",
    displayName: "Claude — Builder (implements work, keeps your queue full)",
  },
];

/* ------------------------------------------------------------------ */
/* 8. testing/test-suite                                               */
/* ------------------------------------------------------------------ */

const TEST_SUITE_HISTORY: RunSummary[] = [
  {
    id: 33344051342,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "action_required",
    createdAt: "2026-08-31T00:15:42Z",
    updatedAt: "2026-08-31T00:15:42Z",
    runStartedAt: "2026-08-31T00:15:42Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/33344051342",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
  {
    id: 32868858549,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-25T15:56:08Z",
    updatedAt: "2026-08-25T15:58:31Z",
    runStartedAt: "2026-08-25T15:56:08Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/32868858549",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
  {
    id: 30771334601,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "failure",
    createdAt: "2026-08-02T23:00:34Z",
    updatedAt: "2026-09-01T23:01:43Z",
    runStartedAt: "2026-08-02T23:00:34Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30771334601",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
  {
    id: 30771294922,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-02T22:59:33Z",
    updatedAt: "2026-08-02T23:02:11Z",
    runStartedAt: "2026-08-02T22:59:33Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30771294922",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
  {
    id: 30770881367,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-08-02T22:47:41Z",
    updatedAt: "2026-08-02T22:50:10Z",
    runStartedAt: "2026-08-02T22:47:41Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30770881367",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
  {
    id: 30395852303,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-07-28T20:19:49Z",
    updatedAt: "2026-07-28T20:22:16Z",
    runStartedAt: "2026-07-28T20:19:49Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30395852303",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
  {
    id: 30387848155,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-07-28T18:31:52Z",
    updatedAt: "2026-07-28T18:34:36Z",
    runStartedAt: "2026-07-28T18:31:52Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30387848155",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
  {
    id: 30385530717,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-07-28T18:01:19Z",
    updatedAt: "2026-07-28T18:03:22Z",
    runStartedAt: "2026-07-28T18:01:19Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30385530717",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
  {
    id: 30303876987,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-07-27T20:44:35Z",
    updatedAt: "2026-07-27T20:48:05Z",
    runStartedAt: "2026-07-27T20:44:35Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30303876987",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
  {
    id: 30051264395,
    name: "Repo — Tests (plain CI, no agent)",
    workflowFile: "repo-tests.yml",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-07-23T22:50:30Z",
    updatedAt: "2026-07-23T22:54:02Z",
    runStartedAt: "2026-07-23T22:50:30Z",
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/actions/runs/30051264395",
    event: "pull_request",
    displayName: "Repo — Tests (plain CI, no agent)",
  },
];

/** The real job steps of run 32868858549. */
const TEST_SUITE_STEPS: JobStep[] = [
  { name: "Set up job", status: "completed", conclusion: "success", number: 1 },
  { name: "Run actions/checkout@v6", status: "completed", conclusion: "success", number: 2 },
  { name: "Detect the project's stack", status: "completed", conclusion: "success", number: 3 },
  { name: "Run actions/setup-node@v4", status: "completed", conclusion: "success", number: 4 },
  { name: "Install dependencies (Node)", status: "completed", conclusion: "success", number: 5 },
  { name: "Prisma client + database", status: "completed", conclusion: "success", number: 6 },
  { name: "Lint (Node)", status: "completed", conclusion: "success", number: 7 },
  { name: "Test (Node)", status: "completed", conclusion: "success", number: 8 },
  { name: "Build (Node)", status: "completed", conclusion: "success", number: 9 },
  { name: "Run actions/setup-python@v5", status: "completed", conclusion: "skipped", number: 10 },
  { name: "Install dependencies (Python)", status: "completed", conclusion: "skipped", number: 11 },
  { name: "Test (Python)", status: "completed", conclusion: "skipped", number: 12 },
  { name: "Nothing to run", status: "completed", conclusion: "skipped", number: 13 },
  { name: "Post Run actions/setup-node@v4", status: "completed", conclusion: "success", number: 25 },
  { name: "Post Run actions/checkout@v6", status: "completed", conclusion: "success", number: 26 },
  { name: "Complete job", status: "completed", conclusion: "success", number: 27 },
];

/* ------------------------------------------------------------------ */
/* 9. testing/metrics-compare                                          */
/* ------------------------------------------------------------------ */

/**
 * Daily averages from `metrics/loop-metrics.json`, split at 2026-07-20 — the
 * day `.github/loop-config.json` landed and the Builder stopped lifting its
 * own overnight cap.
 *
 * Read it honestly: these are per-day averages of CUMULATIVE counters, over
 * 7 days before and 47 days after, and the "after"
 * window includes five weeks in which the loop was largely idle. Merge rate
 * falling is not noise — it is the real story the loop's own retro (#128)
 * documents.
 */
const METRICS_BEFORE_AFTER: Omit<BeforeAfter, "cutoff"> = {
  before: {
    count: 7,
    merge_rate_pct: 90.7,
    prs_merged: 7.3,
    prs_rejected: 0.9,
    median_pr_size_lines: 352,
    proposal_approval_rate_pct: 0,
  },
  after: {
    count: 47,
    merge_rate_pct: 67.2,
    prs_merged: 21.3,
    prs_rejected: 11.1,
    median_pr_size_lines: 324.6,
    proposal_approval_rate_pct: 32.9,
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
    body: () => ({ runs: INSTALL_RUNS, prs: INSTALL_PRS }),
  },
  {
    match: "/api/tools/needs-you",
    body: () => ({ issues: NEEDS_YOU_ISSUES }),
  },
  {
    // GET only — the install POST is never exposed to an anonymous visitor.
    match: "/api/tools/install",
    methods: ["GET"],
    body: () => ({ available: true }),
  },
  {
    match: "/api/tools/fit/repos",
    body: () => ({ projects: FIT_REPOS }),
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
    body: () => ({ groups: INSTRUCTION_GROUPS }),
  },
  {
    match: "/api/testing/runs",
    body: (url: URL) => {
      const file = url.searchParams.get("file");
      const perPageRaw = Number(url.searchParams.get("per_page") ?? "15");
      const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0 ? perPageRaw : 15;
      const runs = (file ? GENERAL_RUNS.filter((r) => r.workflowFile === file) : GENERAL_RUNS).slice(
        0,
        perPage,
      );
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
      const cutoff = url.searchParams.get("date") ?? "2026-07-20";
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
