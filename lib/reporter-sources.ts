/**
 * Source fetchers for the Claude Code Reporter.
 *
 * Each fetcher pulls one upstream source (all free JSON / raw / RSS endpoints —
 * see docs/reporter-sources.md), normalizes it into DigestItem[], and reports a
 * SourceStatus so a failing source degrades gracefully (skip it, show nothing
 * broken) instead of taking the whole digest down.
 *
 * This file does its own GitHub fetches (with GITHUB_TOKEN when present) rather
 * than importing lib/github.ts, so it stays independent of the Octokit client.
 */

import { createHash } from "node:crypto";
import type { DigestCategory, DigestItem, SourceStatus } from "./reporter-types";

type Pulled = { status: SourceStatus; items: DigestItem[] };

const UA =
  "loop-dashboard-reporter/1.0 (+https://github.com/ApagPlayz/loop-dashboard)";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = 9000,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function sha(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string, n = 240): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

/** Normalize a URL for dedupe: lowercase host, drop hash + tracking params. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (/^utm_|^ref$|^ref_src$|^source$/i.test(p)) u.searchParams.delete(p);
    }
    let out = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
    const q = u.searchParams.toString();
    if (q) out += `?${q}`;
    return out.replace(/\/$/, "");
  } catch {
    return raw.trim();
  }
}

function tsOf(date: string | null): number {
  if (!date) return 0;
  const t = Date.parse(date);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Parse a date that may be ISO or awesome-claude-code's custom
 * `YYYY-MM-DD:HH-MM-SS` format. Returns epoch ms, or NaN.
 */
function parseFlexibleDate(raw: string): number {
  const s = raw.trim();
  if (!s) return NaN;
  const m = s.match(/^(\d{4}-\d{2}-\d{2}):(\d{2})-(\d{2})-(\d{2})/);
  if (m) return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Date.parse(s);
}

function item(
  partial: Omit<DigestItem, "id" | "sortTs"> & { sortTs?: number },
): DigestItem {
  const sortTs =
    partial.sortTs ?? (partial.pinned ? Number.MAX_SAFE_INTEGER : tsOf(partial.date));
  return {
    ...partial,
    id: `${partial.sourceKey}:${sha(canonicalUrl(partial.url) + "|" + partial.title)}`,
    sortTs,
  };
}

function ok(key: string, label: string, items: DigestItem[]): Pulled {
  return { status: { key, label, ok: true, count: items.length }, items };
}
function fail(key: string, label: string, error: string): Pulled {
  return { status: { key, label, ok: false, count: 0, error }, items: [] };
}

const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* 1 + 2. Claude Code releases (GitHub Releases API) + CHANGELOG        */
/* ------------------------------------------------------------------ */

type GhRelease = {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
};

/** Parse the top versions out of the raw CHANGELOG markdown. */
function parseChangelog(md: string): { version: string; summary: string }[] {
  const out: { version: string; summary: string }[] = [];
  // Headings look like "## 2.1.211" (sometimes with a date suffix).
  const re = /^#{1,3}\s+v?(\d+\.\d+\.\d+[^\n]*)$/gm;
  const matches = [...md.matchAll(re)];
  for (let i = 0; i < matches.length && i < 25; i++) {
    const m = matches[i];
    const version = (m[1].match(/^\d+\.\d+\.\d+/) ?? [m[1]])[0];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : md.length;
    const bullets = md
      .slice(start, end)
      .split("\n")
      .map((l) => l.replace(/^[-*]\s+/, "").trim())
      .filter((l) => l.length > 0);
    out.push({ version, summary: clip(bullets.slice(0, 4).join(" · "), 260) });
  }
  return out;
}

/** Compare "2.1.211" style versions. Returns >0 if a is newer. */
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function pullClaudeCodeReleases(): Promise<Pulled> {
  const label = "Claude Code releases";
  try {
    const [relRes, clRes] = await Promise.allSettled([
      fetchWithTimeout(
        "https://api.github.com/repos/anthropics/claude-code/releases?per_page=15",
        { headers: githubHeaders() },
      ),
      fetchWithTimeout(
        "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md",
      ),
    ]);

    let releases: GhRelease[] = [];
    if (relRes.status === "fulfilled" && relRes.value.ok) {
      releases = (await relRes.value.json()) as GhRelease[];
    }
    let changelog: { version: string; summary: string }[] = [];
    if (clRes.status === "fulfilled" && clRes.value.ok) {
      changelog = parseChangelog(await clRes.value.text());
    }

    if (releases.length === 0 && changelog.length === 0) {
      return fail("releases", label, "GitHub returned no releases and the CHANGELOG was unreadable.");
    }

    const clByVersion = new Map(changelog.map((c) => [c.version, c.summary]));
    const items: DigestItem[] = [];
    const seen = new Set<string>();

    for (const r of releases) {
      if (r.draft) continue;
      const version = (r.tag_name || r.name || "").replace(/^v/, "");
      if (!version) continue;
      seen.add(version);
      const clSummary = clByVersion.get(version);
      const bodySummary = r.body ? clip(stripHtml(r.body), 260) : "";
      items.push(
        item({
          source: label,
          sourceKey: "releases",
          title: `Claude Code ${r.tag_name || version}`,
          url: r.html_url,
          date: r.published_at,
          category: "code-release",
          summary: clSummary || bodySummary || undefined,
        }),
      );
    }

    // CHANGELOG versions newer than the newest GitHub release = shipped to npm
    // but no release cut yet. Surface them, pinned to the top as brand-new.
    const newestReleased = items[0]
      ? (releases[0].tag_name || releases[0].name || "").replace(/^v/, "")
      : "";
    for (const c of changelog) {
      if (seen.has(c.version)) continue;
      if (newestReleased && cmpVersion(c.version, newestReleased) <= 0) break;
      items.push(
        item({
          source: "Claude Code CHANGELOG",
          sourceKey: "releases",
          title: `Claude Code ${c.version}`,
          url: `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#${c.version.replace(/\./g, "")}`,
          date: null,
          category: "code-release",
          summary: c.summary || undefined,
          pinned: true,
        }),
      );
    }

    return ok("releases", label, items);
  } catch (e) {
    return fail("releases", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 3. Official MCP Registry                                            */
/* ------------------------------------------------------------------ */

type RegistryEntry = {
  server: {
    name: string;
    title?: string;
    description?: string;
    version?: string;
    websiteUrl?: string;
    repository?: { url?: string };
    remotes?: { url?: string }[];
  };
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: {
      updatedAt?: string;
      publishedAt?: string;
      isLatest?: boolean;
      status?: string;
    };
  };
};

async function pullMcpRegistry(): Promise<Pulled> {
  const label = "MCP registry";
  const since = new Date(Date.now() - 45 * DAY).toISOString();
  try {
    const res = await fetchWithTimeout(
      `https://registry.modelcontextprotocol.io/v0/servers?limit=100&updated_since=${encodeURIComponent(since)}`,
    );
    if (!res.ok) return fail("mcp", label, `registry responded ${res.status}`);
    const data = (await res.json()) as { servers?: RegistryEntry[] };
    const entries = data.servers ?? [];
    const items: DigestItem[] = [];
    for (const e of entries) {
      const meta = e._meta?.["io.modelcontextprotocol.registry/official"];
      if (meta?.isLatest === false) continue; // one item per server, latest only
      if (meta?.status && meta.status !== "active") continue;
      const s = e.server;
      const url =
        s.repository?.url ||
        s.websiteUrl ||
        s.remotes?.[0]?.url ||
        `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(s.name)}`;
      const date = meta?.updatedAt || meta?.publishedAt || null;
      items.push(
        item({
          source: label,
          sourceKey: "mcp",
          title: s.title || s.name,
          url,
          date,
          category: "mcp",
          summary: s.description ? clip(s.description, 220) : undefined,
        }),
      );
    }
    items.sort((a, b) => b.sortTs - a.sortTs);
    return ok("mcp", label, items.slice(0, 40));
  } catch (e) {
    return fail("mcp", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 5. awesome-claude-code resources CSV                                */
/* ------------------------------------------------------------------ */

/** Parse one CSV row respecting quoted fields (may contain commas / quotes). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Split full CSV text into rows, honoring quoted newlines. */
function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '""';
        i++;
      } else inQ = !inQ;
      cur += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (cur.length) rows.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.length) rows.push(cur);
  return rows;
}

async function pullAwesomeClaudeCode(): Promise<Pulled> {
  const label = "awesome-claude-code";
  try {
    const res = await fetchWithTimeout(
      "https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/THE_RESOURCES_TABLE_NEW.csv",
      {},
      12000,
    );
    if (!res.ok) return fail("awesome", label, `CSV responded ${res.status}`);
    const rows = splitCsvRows(await res.text());
    if (rows.length < 2) return fail("awesome", label, "CSV had no rows.");
    const header = parseCsvLine(rows[0]).map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const iName = col("display name");
    const iCat = col("category");
    const iLink = col("link");
    const iAuthor = col("author name");
    const iActive = col("active");
    const iDate = col("date added");
    const iDesc = col("description");
    const iStale = col("stale");

    const cutoff = Date.now() - 45 * DAY;
    const items: DigestItem[] = [];
    for (let r = 1; r < rows.length; r++) {
      const c = parseCsvLine(rows[r]);
      const name = (c[iName] ?? "").trim();
      const link = (c[iLink] ?? "").trim();
      const dateRaw = (c[iDate] ?? "").trim();
      if (!name || !link || !dateRaw) continue; // only dated, real resources
      if (iActive >= 0 && (c[iActive] ?? "").trim().toUpperCase() === "FALSE") continue;
      if (iStale >= 0 && (c[iStale] ?? "").trim().toUpperCase() === "TRUE") continue;
      const ts = parseFlexibleDate(dateRaw);
      if (Number.isNaN(ts) || ts < cutoff) continue; // recent additions only
      const catText = `${c[iCat] ?? ""} ${name}`.toLowerCase();
      const category: DigestCategory = /\bmcp\b/.test(catText) ? "mcp" : "skill-plugin";
      const author = (c[iAuthor] ?? "").trim();
      const desc = (c[iDesc] ?? "").trim();
      items.push(
        item({
          source: label,
          sourceKey: "awesome",
          title: author ? `${name} — by ${author}` : name,
          url: link,
          date: new Date(ts).toISOString(),
          category,
          summary: desc ? clip(desc, 220) : undefined,
        }),
      );
    }
    items.sort((a, b) => b.sortTs - a.sortTs);
    return ok("awesome", label, items.slice(0, 40));
  } catch (e) {
    return fail("awesome", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 6. Hacker News (Algolia) — rotating queries                         */
/* ------------------------------------------------------------------ */

type HnHit = {
  objectID: string;
  title?: string;
  story_title?: string;
  url?: string;
  story_url?: string;
  created_at?: string;
  points?: number;
  num_comments?: number;
};

async function pullHackerNews(): Promise<Pulled> {
  const label = "Hacker News";
  const queries = ["claude code", "anthropic mcp", "claude agent", "vibe coding"];
  try {
    const since = Math.floor((Date.now() - 14 * DAY) / 1000);
    const results = await Promise.allSettled(
      queries.map((q) =>
        fetchWithTimeout(
          `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=20`,
        ),
      ),
    );
    const byId = new Map<string, DigestItem>();
    let anyOk = false;
    for (const res of results) {
      if (res.status !== "fulfilled" || !res.value.ok) continue;
      anyOk = true;
      const data = (await res.value.json()) as { hits?: HnHit[] };
      for (const h of data.hits ?? []) {
        const title = h.title || h.story_title;
        if (!title) continue;
        const hnUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
        const url = h.url || h.story_url || hnUrl;
        const points = h.points ?? 0;
        if (points < 3 && (h.num_comments ?? 0) < 2) continue; // drop noise
        const it = item({
          source: label,
          sourceKey: "hn",
          title,
          url,
          date: h.created_at ?? null,
          category: "community",
          summary: `${points} points · ${h.num_comments ?? 0} comments on Hacker News`,
        });
        byId.set(it.id, it);
      }
    }
    if (!anyOk) return fail("hn", label, "all HN queries failed");
    const items = [...byId.values()].sort((a, b) => b.sortTs - a.sortTs).slice(0, 30);
    return ok("hn", label, items);
  } catch (e) {
    return fail("hn", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 7. Anthropic Newsroom (community RSS mirror) — Tier 3, trivial       */
/* ------------------------------------------------------------------ */

function parseRssItems(xml: string): { title: string; link: string; date: string | null; desc: string }[] {
  const out: { title: string; link: string; date: string | null; desc: string }[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const pick = (block: string, tag: string): string => {
    const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    if (!m) return "";
    return m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .trim();
  };
  for (const b of blocks) {
    const title = stripHtml(pick(b, "title"));
    const link = stripHtml(pick(b, "link"));
    const date = pick(b, "pubDate") || pick(b, "dc:date") || null;
    const desc = stripHtml(pick(b, "description"));
    if (title && link) out.push({ title, link, date, desc });
  }
  return out;
}

async function pullAnthropicNews(): Promise<Pulled> {
  const label = "Anthropic news";
  try {
    const res = await fetchWithTimeout(
      "https://raw.githubusercontent.com/taobojlen/anthropic-rss-feed/main/anthropic_news_rss.xml",
    );
    if (!res.ok) return fail("news", label, `RSS mirror responded ${res.status}`);
    const parsed = parseRssItems(await res.text());
    const items = parsed.slice(0, 25).map((p) =>
      item({
        source: label,
        sourceKey: "news",
        title: p.title,
        url: p.link,
        date: p.date ? new Date(p.date).toISOString() : null,
        category: "news",
        summary: p.desc ? clip(p.desc, 240) : undefined,
      }),
    );
    return ok("news", label, items);
  } catch (e) {
    return fail("news", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 9. r/ClaudeAI (needs a real User-Agent; degrade gracefully)         */
/* ------------------------------------------------------------------ */

type RedditChild = {
  data?: {
    title?: string;
    permalink?: string;
    url?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    stickied?: boolean;
  };
};

async function pullReddit(): Promise<Pulled> {
  const label = "r/ClaudeAI";
  try {
    const res = await fetchWithTimeout(
      "https://www.reddit.com/r/ClaudeAI/new.json?limit=25",
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return fail("reddit", label, `Reddit responded ${res.status} (often blocked without OAuth)`);
    const data = (await res.json()) as { data?: { children?: RedditChild[] } };
    const cutoff = Date.now() - 14 * DAY;
    const items: DigestItem[] = [];
    for (const ch of data.data?.children ?? []) {
      const d = ch.data;
      if (!d?.title || d.stickied) continue;
      const created = (d.created_utc ?? 0) * 1000;
      if (created < cutoff) continue;
      if ((d.score ?? 0) < 5 && (d.num_comments ?? 0) < 3) continue;
      items.push(
        item({
          source: label,
          sourceKey: "reddit",
          title: d.title,
          url: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url ?? "",
          date: new Date(created).toISOString(),
          category: "community",
          summary: `${d.score ?? 0} upvotes · ${d.num_comments ?? 0} comments on r/ClaudeAI`,
        }),
      );
    }
    return ok("reddit", label, items.sort((a, b) => b.sortTs - a.sortTs).slice(0, 20));
  } catch (e) {
    // Graceful degrade — Reddit blocking must never break the digest.
    return fail("reddit", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/** Pull every source in parallel. Never throws — failures become statuses. */
export async function pullAllSources(): Promise<{
  items: DigestItem[];
  sources: SourceStatus[];
}> {
  const results = await Promise.all([
    pullClaudeCodeReleases(),
    pullMcpRegistry(),
    pullAwesomeClaudeCode(),
    pullHackerNews(),
    pullAnthropicNews(),
    pullReddit(),
  ]);
  const items = results.flatMap((r) => r.items);
  const sources = results.map((r) => r.status);
  return { items, sources };
}
