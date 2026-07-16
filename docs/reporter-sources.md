# Claude Code Reporter — verified news sources

Research date: 2026-07-15. Every endpoint below was live-verified (curl/WebFetch) on that date.
Feeds the automated "Claude Code Reporter" digest: Claude Code development, Claude models/capabilities,
agentic automation, vibe coding, and new MCP servers / skills / plugins.

## Top pipeline sources

| # | Source | Programmatic access | Covers | Notes |
|---|--------|--------------------|--------|-------|
| 1 | Claude Code CHANGELOG | `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md` (raw markdown) | Every Claude Code change | Ground truth; verified live (v2.1.211 at research time) |
| 2 | Claude Code GitHub Releases | `https://api.github.com/repos/anthropics/claude-code/releases?per_page=10` (JSON) | Release notes | No auth needed (60/hr; 5000/hr with GITHUB_TOKEN) |
| 3 | Official MCP Registry | `https://registry.modelcontextprotocol.io/v0/servers?limit=50` (JSON) | New/updated MCP servers | No auth; has `updatedAt`/`publishedAt` for incremental pulls — authoritative index |
| 4 | modelcontextprotocol/servers repo | `https://api.github.com/repos/modelcontextprotocol/servers` (GitHub API) | Reference MCP servers | Active (pushed 2026-07-10, 88.5k stars) |
| 5 | awesome-claude-code resources CSV | `https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/THE_RESOURCES_TABLE_NEW.csv` (raw CSV: ID, Name, Category, Link, Author, Date Added, Description) | New plugins/skills/MCPs/workflows | Extremely active (same-day commits, 50k+ stars) — best curated feed |
| 6 | Hacker News (Algolia API) | `https://hn.algolia.com/api/v1/search_by_date?query=claude+code&tags=story&hitsPerPage=25` (JSON) | Community news/discussion | Rotate queries: "anthropic", "mcp server", "vibe coding", "claude agent" |
| 7 | Anthropic Newsroom | https://www.anthropic.com/news (no official RSS); community mirror feed: `https://raw.githubusercontent.com/taobojlen/anthropic-rss-feed/main/anthropic_news_rss.xml` (RSS 2.0) | Official announcements | Mirror verified valid, current within ~2 weeks |
| 8 | Claude Code / Platform docs release notes | `https://code.claude.com/docs/en/changelog`, `https://platform.claude.com/docs/en/release-notes/overview` (HTML) | API/model-level notes | Mostly redundant with #1 except platform-level items |
| 9 | r/ClaudeAI | `https://www.reddit.com/r/ClaudeAI/new.json?limit=25` (JSON) | Community happenings | Blocked from the research sandbox (needs a real User-Agent); verify from the production runner; consider OAuth for reliability |
| 10 | PulseMCP | https://www.pulsemcp.com/ (API at api.pulsemcp.com) | MCP directory | Free v0beta endpoint being sunset (failing now); v0.1 needs an API key — the official registry (#3) covers the same ground without auth |

## Secondary sources

- **Anthropic Engineering blog** — no RSS, scrape.
- **Claude status page** — Atom feed via `/history.atom`.
- **Simon Willison's blog/TILs** (claude-code tag) — Atom feed; very high-signal independent commentary.
- **Other awesome-lists** (subinium, jqueryscript, ComposioHQ, rohitg00) — overlap with #5; use only for dedupe cross-checks.
- **Smithery registry API** — lower priority than the official registry.
- **mcp.so** — largest directory (~20k servers), HTML only.
- **Vibe Coding Weekly** — Substack, `/feed` RSS.
- **TLDR AI** — tldr.tech/ai, broad AI cross-check.
- **X accounts** — @AnthropicAI, @claudeai, @claude_news, @alexalbert__ — no clean free API; manual/occasional only.
- **YouTube @claude channel** — RSS via `youtube.com/feeds/videos.xml?channel_id=...`.

## Recommended pull strategy

- **Tier 1 (every run — cheap, structured):** sources #1–5 (GitHub API + registries). Diff against last-seen checkpoints (release id / CSV row ID / `updatedAt`).
- **Tier 2 (every run — query fan-out):** HN Algolia with rotating queries; Reddit if reachable.
- **Tier 3 (every 2–3 days):** Anthropic Newsroom RSS mirror, Engineering blog scrape, Simon Willison, newsletters.
- **Dedupe:** by canonical URL first, then GitHub id / CSV ID (titles repeat across mirrors). Merge same-event items (e.g., a release + its HN thread) into one digest entry.
- **Lookback:** 48h for GitHub/registry sources, 24h for HN/Reddit, always with a persisted per-source last-seen checkpoint.
- **Before going live:** use a GitHub token for rate limits (already available as GITHUB_TOKEN), optionally register a PulseMCP key, and verify Reddit's `.json` endpoint from the production network with a proper User-Agent.
