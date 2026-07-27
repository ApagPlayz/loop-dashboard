# Claude Code Reporter — verified news sources

Research date: 2026-07-15 (endpoints re-verified 2026-07-22 when the technique / discussion sources
were wired up). Every endpoint below was live-verified (curl/WebFetch).
Feeds the automated "Claude Code Reporter" digest: Claude Code development, Claude models/capabilities,
agentic automation, vibe coding, and new MCP servers / skills / plugins.

## What the Reporter is (and isn't)

The Reporter is a **global Claude-ecosystem digest — reading material, not an input to the loop.**
It pulls the same 11 ecosystem-wide sources for everyone, takes no project parameter, and knows
nothing about the repos registered in `config/projects.json`. Nothing it produces is filtered by,
attributed to, or connected to a project: no digest item ever becomes a proposal issue, reaches the
Scout's prompt, or influences what gets built. Improvement ideas come from the Scout agent reading
the target repo at runtime (see `config/loop-template/workflows/claude-scout.yml`); the two systems
are entirely separate. Treat the News tab as "what happened in Claude-land this week", and don't
read per-project relevance into it. (Making it project-aware — per-repo `interests[]`, "file this as
a proposal" — is an open idea, not a thing that exists.)

## Implemented sources (live in `lib/reporter-sources.ts`)

Every fetcher below is registered in `pullAllSources()` and reports a `SourceStatus`, so a single
source failing degrades gracefully (it shows as failed in the UI strip; the rest of the digest is fine).

| Fetcher | Endpoint | Category | Notes |
|---------|----------|----------|-------|
| `pullClaudeCodeReleases` | GitHub Releases API + raw `CHANGELOG.md` | `code-release` | Ground truth; CHANGELOG versions newer than the newest release are pinned as brand-new |
| `pullMcpRegistry` | `https://registry.modelcontextprotocol.io/v0/servers` | `mcp` | Fixed 45-day window: `updated_since` is computed as `now − 45d` on every pull, **not** resumed from a stored cursor |
| `pullAwesomeClaudeCode` | raw `THE_RESOURCES_TABLE_NEW.csv` | `mcp` / `skill-plugin` | Best curated feed; last-45-days window |
| `pullHackerNews` | HN Algolia `search_by_date` + `items/{id}` | `community` | **Now also pulls the top ~5 comments** (`items/{objectID}` → `children[].text`, HTML-stripped, ≤500 chars) into `discussion` for the top ~15 kept stories, as real sentiment input. `discussionUrl` = HN thread |
| `pullAnthropicNews` | community RSS mirror (`taobojlen/anthropic-rss-feed`) | `news` | Anthropic-only announcements |
| `pullAlphaSignal` | `https://alphasignalai.substack.com/feed` | `ai-news` | Broad AI industry news |
| `pullSimonWillison` | `https://simonwillison.net/atom/everything/` (Atom) | `technique` | **Live** — high-signal independent how-to/commentary; 30-day window, ~220-char clips |
| `pullAnthropicEngineering` | probes `anthropic.com/engineering/rss.xml` then `anthropic.com/rss.xml` | `technique` | **Wired but currently dormant** — both candidate feeds return 404 as of 2026-07-22, so it fails gracefully (`ok:false`, no items, never throws). Auto-activates if/when Anthropic ships a real RSS/Atom feed at either path |
| `pullTldrAi` | `https://tldr.tech/api/rss/ai` (RSS 2.0) | `ai-news` | **Live** — clean daily newsletter feed; 21-day window (titles only, no per-item body) |
| `pullReddit` | `r/ClaudeAI/.rss` + `r/ClaudeCode/.rss` (Atom) | `community` | **Rewritten to RSS** — the OAuth-gated `.json` path is gone. Each entry's HTML `<content>` body becomes a `discussion` snippet (≤500 chars) for sentiment; megathread boilerplate is dropped; `discussionUrl` = thread link |
| `pullClaudeCodeDiscussions` | GitHub GraphQL `repository.discussions(first:15, UPDATED_AT desc)` | `community` | **Live when `GITHUB_TOKEN` is set** — pulse of real usage; `bodyText` (≤500 chars) → `discussion`. No token ⇒ graceful `ok:false`, no throw |

Community items (`pullHackerNews`, `pullReddit`, `pullClaudeCodeDiscussions`) carry a transient
`discussion[]` that `lib/reporter-enrich.ts` distills into a one-line `insight` and then clears —
the raw discussion text is never persisted or shown.

## Original research — top pipeline sources

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
| 11 | AlphaSignal | `https://alphasignalai.substack.com/feed` (RSS 2.0) | Broad AI industry news (any lab/model, not Anthropic-specific) | Added 2026-07-20. No official API on alphasignal.ai and their own site explicitly prohibits scraping (Terms §6) — but the newsletter is published through Substack, which gives every publication a standard RSS feed as an intentional feature; confirmed live with current items. New `ai-news` digest category, kept separate from `news` (which is Anthropic-only). |

## Secondary sources

- **Anthropic Engineering blog** — no clean RSS confirmed (both `/engineering/rss.xml` and `/rss.xml` 404 as of 2026-07-22). `pullAnthropicEngineering` probes both and degrades gracefully; would auto-activate if a feed appears. Otherwise needs a scrape.
- **Claude status page** — Atom feed via `/history.atom`.
- **Simon Willison's blog/TILs** — Atom feed at `/atom/everything/`; very high-signal independent commentary. **Now implemented** (`pullSimonWillison`, category `technique`).
- **Other awesome-lists** (subinium, jqueryscript, ComposioHQ, rohitg00) — overlap with #5; use only for dedupe cross-checks.
- **Smithery registry API** — lower priority than the official registry.
- **mcp.so** — largest directory (~20k servers), HTML only.
- **Vibe Coding Weekly** — Substack, `/feed` RSS.
- **TLDR AI** — `tldr.tech/api/rss/ai`, broad AI cross-check. **Now implemented** (`pullTldrAi`, category `ai-news`).
- **GitHub Discussions** (anthropics/claude-code) — GraphQL, token-gated. **Now implemented** (`pullClaudeCodeDiscussions`, category `community`).
- **X accounts** — @AnthropicAI, @claudeai, @claude_news, @alexalbert__ — no clean free API; manual/occasional only.
- **YouTube @claude channel** — RSS via `youtube.com/feeds/videos.xml?channel_id=...`.

## Actual pull strategy (what the code does)

- **No incremental state. Every pull is a full fixed-window re-read**, on every run, of every
  source: 45 days (MCP registry, awesome-claude-code, Anthropic Engineering), 30 days (Simon
  Willison), 21 days (TLDR AI, Reddit), 14 days (Hacker News), whatever the feed returns
  (releases/CHANGELOG, Anthropic news, AlphaSignal, GitHub Discussions). There are no per-source
  cursors or checkpoints — a version of this existed, was written to the cache and never read by
  anything, and was deleted in July 2026. Fixed windows are the deliberate choice here: they're
  self-healing, and the cache they'd have to be stored in isn't durable (below).
- **Dedupe happens after the pull, not during it** (`lib/reporter.ts`): by canonical URL, except
  `code-release` items which collapse by version number. Re-reading the same window every run is
  therefore free of duplicates; a merge with the cached digest preserves dates, summaries and
  AI-derived insights that a fresh pull hasn't re-derived.
- **All 11 sources run in parallel** and every failure degrades to a `SourceStatus` in the UI strip
  — one dead source never sinks the digest.
- **The cache is best-effort, not storage** (`lib/reporter-store.ts`): an in-memory copy backed by a
  JSON file under `os.tmpdir()`. Locally that survives for the life of the dev server; on Vercel
  it's per-lambda-instance and gone on every cold start. So a cold request builds the digest under
  an 8-second pull budget and skips AI enrichment (`getDigest`), while the full job — no budget,
  plus enrichment — runs on the 6-hourly Vercel cron and on "Refresh now" (`refreshDigest`).
- **Rate limits:** `GITHUB_TOKEN` is used when present (also required for the GitHub Discussions
  source, which reports `ok:false` without it).

## Original recommended strategy (2026-07-15 research — aspirational, not implemented)

Kept for reference. The checkpoint-based incremental design below was never built; see the actual
strategy above for what runs.

- **Tier 1 (every run — cheap, structured):** sources #1–5 (GitHub API + registries). Diff against last-seen checkpoints (release id / CSV row ID / `updatedAt`).
- **Tier 2 (every run — query fan-out):** HN Algolia with rotating queries; Reddit if reachable.
- **Tier 3 (every 2–3 days):** Anthropic Newsroom RSS mirror, Engineering blog scrape, Simon Willison, newsletters.
- **Dedupe:** by canonical URL first, then GitHub id / CSV ID (titles repeat across mirrors). Merge same-event items (e.g., a release + its HN thread) into one digest entry.
- **Lookback:** 48h for GitHub/registry sources, 24h for HN/Reddit, always with a persisted per-source last-seen checkpoint.
- **Before going live:** use a GitHub token for rate limits (already available as GITHUB_TOKEN), optionally register a PulseMCP key, and verify Reddit's `.json` endpoint from the production network with a proper User-Agent.
