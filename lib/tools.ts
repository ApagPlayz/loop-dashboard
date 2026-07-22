/**
 * Server-side helpers for the Tools section.
 *
 * The centrepiece is capability parsing: we read each agent's workflow YAML
 * (and the repo-root .mcp.json) and pull out which built-in tools, MCP servers
 * and skills that agent is allowed to use, so the owner can see "what my agents
 * can do today" in plain language.
 *
 * We deliberately DON'T pull in a YAML parser — the fields we need
 * (`--allowedTools "..."`, `--model ...`, `--mcp-config ...`, and the
 * anthropics/claude-code-action marker) are read with small, tolerant regexes
 * against the raw text. That keeps the dependency surface tiny and survives odd
 * formatting.
 */

import { getFileContent, REPOS, getOctokit, type RepoConfig } from "@/lib/github";

const { owner, repo } = REPOS.primary;

/**
 * Legacy fallback branch: if a workflow file isn't on main, we look here before
 * giving up. All workflows normally live on main; this only helps a project
 * mid-onboarding whose support workflows haven't merged yet.
 */
export const FALLBACK_BRANCH = "claude/dashboard-support-workflows";

/* ------------------------------------------------------------------ */
/* Target-agent picker metadata (used by the add-a-tool form)          */
/* ------------------------------------------------------------------ */

export const TARGET_AGENTS: { value: string; label: string; blurb: string }[] = [
  { value: "all", label: "All agents", blurb: "Give every agent this tool." },
  { value: "scout", label: "Scout", blurb: "Finds work and files proposals." },
  { value: "builder", label: "Builder", blurb: "Writes the code and opens PRs." },
  { value: "audit", label: "Auditor", blurb: "Reviews every PR and gives a verdict." },
  { value: "retro", label: "Retro", blurb: "Reviews how the loop is doing." },
  { value: "mention", label: "Mention", blurb: "Replies when you write @claude." },
  { value: "demo", label: "Demo", blurb: "Captures screenshots / video evidence." },
];

/* ------------------------------------------------------------------ */
/* Capability inventory                                                */
/* ------------------------------------------------------------------ */

/** The agent workflows we show capability cards for (script-only ones excluded). */
export const AGENT_WORKFLOWS: {
  file: string;
  name: string;
  blurb: string;
}[] = [
  { file: "claude-scout.yml", name: "Scout", blurb: "Finds work, files proposals" },
  { file: "claude-builder.yml", name: "Builder", blurb: "Writes code, opens PRs" },
  { file: "claude-audit.yml", name: "Auditor", blurb: "Reviews PRs" },
  { file: "claude-mention.yml", name: "Mention", blurb: "Replies to @claude" },
  { file: "claude-retro.yml", name: "Retro", blurb: "Reviews the loop" },
  { file: "claude-redraft.yml", name: "Redraft", blurb: "Rewrites proposals" },
  { file: "claude-demo.yml", name: "Demo", blurb: "Captures evidence" },
  {
    file: "claude-tool-install.yml",
    name: "Tool installer",
    blurb: "Installs new tools",
  },
];

/** Friendly names for the built-in Claude Code tools. */
const TOOL_LABELS: Record<string, string> = {
  Bash: "Run commands",
  BashOutput: "Read command output",
  KillShell: "Stop commands",
  Read: "Read files",
  Write: "Write files",
  Edit: "Edit files",
  Glob: "Find files",
  Grep: "Search code",
  Task: "Spawn sub-agents",
  TodoWrite: "Track a to-do list",
  WebSearch: "Search the web",
  WebFetch: "Read web pages",
};

export function friendlyToolName(raw: string): string {
  // MCP tools look like mcp__server__tool — surface the server + tool.
  if (raw.startsWith("mcp__")) {
    const parts = raw.split("__");
    return parts.length >= 3 ? `${parts[1]}: ${parts[2]}` : raw;
  }
  return TOOL_LABELS[raw] ?? raw;
}

export type AgentCapabilities = {
  file: string;
  name: string;
  blurb: string;
  found: boolean; // did we find a claude-code-action step at all?
  isAgent: boolean; // true if it runs claude-code-action (vs a plain script)
  model: string | null;
  builtinTools: string[]; // friendly names
  mcpServers: string[]; // server names referenced/available
  skills: string[];
  source: "main" | FallbackBranch;
};

type FallbackBranch = typeof FALLBACK_BRANCH;

/**
 * Extract the first `--allowedTools "..."` list from a claude_args block.
 * Handles both quote styles and the multi-line YAML block-scalar form.
 */
function parseAllowedTools(yaml: string): string[] {
  const m =
    yaml.match(/--allowedTools\s+"([^"]*)"/) ??
    yaml.match(/--allowedTools\s+'([^']*)'/) ??
    yaml.match(/--allowed-tools\s+"([^"]*)"/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseModel(yaml: string): string | null {
  const m = yaml.match(/--model\s+([A-Za-z0-9._-]+)/);
  return m ? m[1] : null;
}

/** MCP server names referenced by the workflow (--mcp-config path or inline). */
function parseMcpRefs(yaml: string): boolean {
  return /--mcp-config|mcp_config|mcpServers/i.test(yaml);
}

type McpConfig = { mcpServers?: Record<string, unknown> };

function parseMcpServers(json: string | null): string[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json) as McpConfig;
    return data.mcpServers ? Object.keys(data.mcpServers) : [];
  } catch {
    return [];
  }
}

/**
 * Read + parse one agent workflow's capabilities. Tries main first, then falls
 * back to the onboarding branch for any workflow that hasn't merged yet. The
 * repo-level MCP servers (from .mcp.json) are passed in so we don't re-fetch.
 */
async function parseAgentWorkflow(
  file: string,
  name: string,
  blurb: string,
  mcpServers: string[],
  repo: RepoConfig = REPOS.primary,
): Promise<AgentCapabilities> {
  let yaml = await getFileContent(`.github/workflows/${file}`, undefined, repo);
  let source: "main" | FallbackBranch = "main";
  if (yaml === null) {
    yaml = await getFileContent(`.github/workflows/${file}`, FALLBACK_BRANCH, repo);
    source = FALLBACK_BRANCH;
  }

  const base: AgentCapabilities = {
    file,
    name,
    blurb,
    found: false,
    isAgent: false,
    model: null,
    builtinTools: [],
    mcpServers: [],
    skills: [],
    source,
  };

  if (!yaml) return base;

  const isAgent = /anthropics\/claude-code-action/.test(yaml);
  base.isAgent = isAgent;
  if (!isAgent) return base;

  base.found = true;
  base.model = parseModel(yaml);

  const rawTools = parseAllowedTools(yaml);
  const builtin: string[] = [];
  const mcpFromTools = new Set<string>();
  for (const t of rawTools) {
    if (t.startsWith("mcp__")) {
      const server = t.split("__")[1];
      if (server) mcpFromTools.add(server);
    } else {
      builtin.push(friendlyToolName(t));
    }
  }
  base.builtinTools = builtin;

  // MCP servers this agent can use: any it references from tool names, plus the
  // repo-level servers if the workflow wires in an mcp config.
  const servers = new Set<string>(mcpFromTools);
  if (parseMcpRefs(yaml)) for (const s of mcpServers) servers.add(s);
  base.mcpServers = [...servers];

  // Skills: allowedTools entries of the form Skill(name) or skills referenced.
  const skillMatches = [...yaml.matchAll(/Skill\(([^)]+)\)/g)].map((m) => m[1]);
  base.skills = [...new Set(skillMatches)];

  return base;
}

export type SharedCapabilities = {
  builtinTools: string[];
  mcpServers: string[];
  skills: string[];
};

/**
 * Capabilities EVERY agent already has: the intersection across all agent
 * workflows, plus anything defined at the repo root (.mcp.json servers are
 * inherently shared) which we surface even if per-workflow wiring differs.
 */
export function computeSharedCapabilities(
  agents: AgentCapabilities[],
  repoMcpServers: string[],
): SharedCapabilities {
  const real = agents.filter((a) => a.isAgent);
  const intersect = (pick: (a: AgentCapabilities) => string[]): string[] => {
    if (real.length === 0) return [];
    let set = new Set(pick(real[0]));
    for (const a of real.slice(1)) {
      const s = new Set(pick(a));
      set = new Set([...set].filter((x) => s.has(x)));
    }
    return [...set];
  };
  const mcp = new Set(intersect((a) => a.mcpServers));
  // Repo-root MCP servers are shared by definition.
  for (const s of repoMcpServers) mcp.add(s);
  return {
    builtinTools: intersect((a) => a.builtinTools),
    mcpServers: [...mcp],
    skills: intersect((a) => a.skills),
  };
}

export async function loadCapabilityInventory(
  repo: RepoConfig = REPOS.primary,
): Promise<{
  agents: AgentCapabilities[];
  repoMcpServers: string[];
  shared: SharedCapabilities;
}> {
  // .mcp.json can live on main or only on the onboarding branch.
  const mcpRaw =
    (await getFileContent(".mcp.json", undefined, repo)) ??
    (await getFileContent(".mcp.json", FALLBACK_BRANCH, repo));
  const repoMcpServers = parseMcpServers(mcpRaw);

  const agents = await Promise.all(
    AGENT_WORKFLOWS.map((w) =>
      parseAgentWorkflow(w.file, w.name, w.blurb, repoMcpServers, repo),
    ),
  );
  const shared = computeSharedCapabilities(agents, repoMcpServers);
  return { agents, repoMcpServers, shared };
}

/* ------------------------------------------------------------------ */
/* "Needs you" — action-needed issues                                  */
/* ------------------------------------------------------------------ */

export type ActionIssue = {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  createdAt: string;
};

const ACTION_PREFIX = "🔑 Action needed";

/** Open issues whose title starts with the tool-install "action needed" flag. */
export async function listActionNeededIssues(): Promise<ActionIssue[]> {
  const res = await getOctokit().rest.issues.listForRepo({
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  return res.data
    .filter((i) => !i.pull_request && i.title.startsWith(ACTION_PREFIX))
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? "",
      htmlUrl: i.html_url,
      createdAt: i.created_at,
    }));
}

/* ------------------------------------------------------------------ */
/* Install activity                                                    */
/* ------------------------------------------------------------------ */

export type ToolPr = {
  number: number;
  title: string;
  branch: string;
  htmlUrl: string;
  createdAt: string;
};

/** Open claude/ PRs whose title/branch look like a tool install. */
export async function listToolInstallPrs(): Promise<ToolPr[]> {
  const res = await getOctokit().rest.pulls.list({
    owner,
    repo,
    state: "open",
    per_page: 50,
  });
  const rx = /tool|install|mcp|skill|plugin/i;
  return res.data
    .filter((pr) => {
      const branch = pr.head?.ref ?? "";
      return (
        branch.startsWith("claude/") && (rx.test(branch) || rx.test(pr.title))
      );
    })
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.head?.ref ?? "",
      htmlUrl: pr.html_url,
      createdAt: pr.created_at,
    }));
}
