/**
 * Parse an agent's capabilities out of its workflow YAML plus the repo-root
 * .mcp.json. Deliberately regex-based and forgiving — it never throws, it just
 * returns whatever it can find. Read-only: adding capabilities is the Tools
 * section's job.
 */

import type { Capabilities } from "./map-types";

/** Extract the `--allowedTools "a,b,c"` list from claude_args. */
function parseTools(yaml: string): string[] {
  // Match --allowedTools followed by a quoted list (single or double quotes).
  const m = yaml.match(/--allowedTools\s+["']([^"']*)["']/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Extract skills, if the workflow references any (--skill / skills dir). */
function parseSkills(yaml: string): string[] {
  const skills = new Set<string>();
  const re = /--skill(?:s)?\s+["']?([^"'\s]+)["']?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yaml))) skills.add(m[1]);
  return [...skills];
}

/** Names of MCP servers declared in .mcp.json. */
function parseMcpServers(mcpJson: string | null): string[] {
  if (!mcpJson) return [];
  try {
    const parsed = JSON.parse(mcpJson);
    const servers = parsed?.mcpServers ?? parsed?.servers ?? {};
    return Object.keys(servers);
  } catch {
    return [];
  }
}

/**
 * @param yaml     the workflow file contents (may be null / partial)
 * @param mcpJson  the target repo's .mcp.json contents (may be null)
 */
export function parseCapabilities(yaml: string | null, mcpJson: string | null): Capabilities {
  const usesClaude = !!yaml && yaml.includes("claude-code-action");
  return {
    tools: yaml ? parseTools(yaml) : [],
    // Only surface MCP servers for workflows that actually boot a Claude agent.
    mcpServers: usesClaude ? parseMcpServers(mcpJson) : [],
    skills: yaml ? parseSkills(yaml) : [],
  };
}
