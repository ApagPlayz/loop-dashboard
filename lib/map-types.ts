/**
 * Shared types for the Process Map section. Kept framework-free so both server
 * (API routes) and client (React Flow nodes, drawer) can import them.
 */

/** Where a workflow's Claude prompt lives, if anywhere. */
export type DispatchKind = "none" | "issue" | "pr";

/** Static, hand-written description of one loop workflow. */
export type AgentMeta = {
  id: string;
  /** Plain-English name shown on the node and drawer. */
  label: string;
  /** Workflow filename in .github/workflows. */
  file: string;
  /** Short tagline shown under the node title. */
  tagline: string;
  /** Plain-English paragraph(s) of what this agent does. */
  description: string;
  /** Plain-English list of when it runs. */
  triggers: string[];
  /**
   * True if the workflow already lives on the target repo's main branch. The
   * PR #44 workflows (demo, redraft, tool-install) are false until it merges —
   * editing and "Run now" are disabled for those with an explanatory note.
   */
  onMain: boolean;
  /** True if the workflow declares workflow_dispatch (a "Run now" is possible). */
  canDispatch: boolean;
  /** Shape of the input the manual run needs, when it needs one. */
  dispatch: DispatchKind;
  /** Label + help text for the dispatch input, when dispatch !== "none". */
  dispatchInputLabel?: string;
  dispatchInputHelp?: string;
};

/** One historical workflow run, trimmed for the drawer. */
export type RunSummary = {
  id: number;
  status: string | null;
  conclusion: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Duration in seconds, when computable. */
  durationSec: number | null;
  url: string;
};

/** Live status of one agent node, for the map badges. */
export type AgentStatus = {
  id: string;
  file: string;
  status: string | null; // queued | in_progress | completed | null (never run)
  conclusion: string | null; // success | failure | cancelled | ...
  createdAt: string | null;
  url: string | null;
};

/** Everything the map needs to render its live badges. */
export type MapStatus = {
  proposals: number;
  approved: number;
  openPRs: number;
  agents: AgentStatus[];
  /** Non-fatal warning (e.g. a partial failure) to surface in the UI. */
  warning?: string;
};

/** Capability chips parsed from a workflow's YAML + .mcp.json. */
export type Capabilities = {
  tools: string[];
  mcpServers: string[];
  skills: string[];
};

/** Full payload for the agent drawer. */
export type AgentDetail = {
  meta: AgentMeta;
  runs: RunSummary[];
  capabilities: Capabilities;
  /** The workflow ref the YAML was read from ("main" or the PR branch). */
  ref: string;
  /** True when the file was found. */
  fileFound: boolean;
  /** Friendly prompt text, when extractable. */
  prompt: string | null;
  /** Raw YAML of the workflow file. */
  rawYaml: string | null;
  /** True when the friendly prompt extractor succeeded. */
  promptExtractable: boolean;
  /** Reason extraction failed, when it did. */
  extractionNote?: string;
  /** True when instructions can be saved (file on main). */
  editable: boolean;
  /** GitHub link to the file's commit history. */
  historyUrl: string;
};
