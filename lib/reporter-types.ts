/**
 * Shared types for the Claude Code Reporter — a compiled digest of new
 * happenings across Claude Code, Claude models, agentic automation, vibe
 * coding, and new MCP servers / skills / plugins.
 *
 * See docs/reporter-sources.md for the verified source list and pull strategy.
 */

export type DigestCategory =
  | "code-release" // Claude Code releases / changelog
  | "mcp" // new / updated MCP servers
  | "skill-plugin" // Claude Code skills, plugins, slash-commands, hooks
  | "news" // official Anthropic announcements
  | "technique" // how-to / workflow / technique commentary (Simon Willison, Anthropic Engineering, newsletters)
  | "ai-news" // broader AI industry news (not Anthropic-specific), e.g. AlphaSignal
  | "community"; // HN / Reddit discussion

/** One normalized item in the digest. */
export type DigestItem = {
  /** Stable key used for dedupe and as a React key. */
  id: string;
  /** Human-readable source label, e.g. "Claude Code releases". */
  source: string;
  /** Machine source key, e.g. "releases". */
  sourceKey: string;
  title: string;
  url: string;
  /** ISO date string, or null when the source gives no date. */
  date: string | null;
  category: DigestCategory;
  /** Short plain-English snippet. */
  summary?: string;
  /**
   * Sort timestamp (epoch ms). Higher = newer / more prominent. Freshly-shipped
   * versions that have no date yet are pinned to the top.
   */
  sortTs: number;
  /** True for just-shipped items that should always read as brand-new. */
  pinned?: boolean;
  /**
   * Transient: raw top-comment / discussion text pulled for a community item
   * (HN comments, Reddit post body). Consumed by the enrichment step to derive
   * `insight`, then cleared before the digest is persisted — never shown raw.
   */
  discussion?: string[];
  /**
   * AI-distilled one-liner of what people actually think / how they're using the
   * thing, derived from `discussion`. This is the real "sentiment" signal.
   */
  insight?: string;
  /** Direct link to the discussion thread (HN/Reddit), when different from url. */
  discussionUrl?: string;
};

/** Per-source outcome of the last pull, for the "sources" status strip. */
export type SourceStatus = {
  key: string;
  label: string;
  ok: boolean;
  count: number;
  error?: string;
};

/** The whole cached digest. */
export type Digest = {
  items: DigestItem[];
  /** ISO timestamp of the last successful refresh. */
  lastUpdated: string;
  /** Outcome of each source in the last refresh. */
  sources: SourceStatus[];
};

export const CATEGORY_LABELS: Record<DigestCategory, string> = {
  "code-release": "Claude Code",
  mcp: "MCP servers",
  "skill-plugin": "Skills & plugins",
  news: "Anthropic news",
  technique: "Techniques",
  "ai-news": "AI news",
  community: "Community",
};

export const CATEGORY_ORDER: DigestCategory[] = [
  "code-release",
  "news",
  "technique",
  "ai-news",
  "mcp",
  "skill-plugin",
  "community",
];
