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
    // Keep the story item alongside its HN objectID so we can pull comments.
    const byId = new Map<string, { it: DigestItem; objectID: string }>();
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
          discussionUrl: hnUrl,
        });
        if (!byId.has(it.id)) byId.set(it.id, { it, objectID: h.objectID });
      }
    }
    if (!anyOk) return fail("hn", label, "all HN queries failed");
    const ranked = [...byId.values()].sort((a, b) => b.it.sortTs - a.it.sortTs).slice(0, 30);

    // For the top stories we actually keep, pull the top few comments as real
    // sentiment input for the enrichment step. Best-effort and bounded (~15
    // stories): a comment-fetch failure just leaves that story without a
    // discussion — it never sinks the source.
    await Promise.all(
      ranked.slice(0, 15).map(async ({ it, objectID }) => {
        try {
          const cres = await fetchWithTimeout(
            `https://hn.algolia.com/api/v1/items/${objectID}`,
            {},
            8000,
          );
          if (!cres.ok) return;
          const tree = (await cres.json()) as { children?: { text?: string | null }[] };
          const comments: string[] = [];
          for (const c of tree.children ?? []) {
            if (!c.text) continue;
            const t = clip(stripHtml(c.text), 500);
            if (t.length >= 20) comments.push(t);
            if (comments.length >= 5) break;
          }
          if (comments.length) it.discussion = comments;
        } catch {
          // ignore — keep the story without discussion
        }
      }),
    );

    const items = ranked.map((r) => r.it);
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

/** Extract the inner text of the first <tag>…</tag> in a block, unwrapping CDATA. */
function xmlTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

/**
 * Parse Atom <entry> blocks (Simon Willison, Reddit RSS, some blog feeds).
 * Atom differs from RSS 2.0: the link lives in a <link href="…"> attribute and
 * the body is <content>/<summary> rather than <description>. Returns the raw
 * HTML body so callers can either summarize it or keep it as `discussion`.
 */
function parseAtomEntries(
  xml: string,
): { title: string; link: string; date: string | null; html: string }[] {
  const out: { title: string; link: string; date: string | null; html: string }[] = [];
  const blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const pickLink = (block: string): string => {
    const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const chosen =
      links.find((l) => /rel=["']alternate["']/i.test(l)) ??
      links.find((l) => !/rel=/i.test(l)) ??
      links[0];
    if (!chosen) return "";
    const m = chosen.match(/href=["']([^"']+)["']/i);
    return m ? stripHtml(m[1]) : "";
  };
  for (const b of blocks) {
    const title = stripHtml(xmlTag(b, "title"));
    const link = pickLink(b);
    const date = xmlTag(b, "published") || xmlTag(b, "updated") || null;
    const html = xmlTag(b, "content") || xmlTag(b, "summary") || "";
    if (title && link) out.push({ title, link, date, html });
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
/* 9. AlphaSignal (daily AI newsletter, published via Substack)        */
/* ------------------------------------------------------------------ */

async function pullAlphaSignal(): Promise<Pulled> {
  const label = "AlphaSignal";
  try {
    const res = await fetchWithTimeout("https://alphasignalai.substack.com/feed");
    if (!res.ok) return fail("alphasignal", label, `Feed responded ${res.status}`);
    const parsed = parseRssItems(await res.text());
    const items = parsed.slice(0, 25).map((p) =>
      item({
        source: label,
        sourceKey: "alphasignal",
        title: p.title,
        url: p.link,
        date: p.date ? new Date(p.date).toISOString() : null,
        category: "ai-news",
        summary: p.desc ? clip(p.desc, 240) : undefined,
      }),
    );
    return ok("alphasignal", label, items);
  } catch (e) {
    return fail("alphasignal", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 12. Simon Willison (Atom) — high-signal independent commentary       */
/* ------------------------------------------------------------------ */

async function pullSimonWillison(): Promise<Pulled> {
  const label = "Simon Willison";
  try {
    const res = await fetchWithTimeout("https://simonwillison.net/atom/everything/");
    if (!res.ok) return fail("simonw", label, `Atom feed responded ${res.status}`);
    const entries = parseAtomEntries(await res.text());
    const cutoff = Date.now() - 30 * DAY;
    const items: DigestItem[] = [];
    for (const e of entries) {
      const ts = e.date ? Date.parse(e.date) : NaN;
      if (Number.isNaN(ts) || ts < cutoff) continue; // recent commentary only
      items.push(
        item({
          source: label,
          sourceKey: "simonw",
          title: e.title,
          url: e.link,
          date: new Date(ts).toISOString(),
          category: "technique",
          summary: e.html ? clip(stripHtml(e.html), 220) : undefined,
        }),
      );
    }
    items.sort((a, b) => b.sortTs - a.sortTs);
    return ok("simonw", label, items.slice(0, 30));
  } catch (e) {
    return fail("simonw", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 13. Anthropic Engineering blog — try RSS/Atom, degrade if none       */
/* ------------------------------------------------------------------ */

async function pullAnthropicEngineering(): Promise<Pulled> {
  const label = "Anthropic Engineering";
  // No confirmed clean feed as of 2026-07; probe the likely paths and fall
  // back gracefully (no throw) when none responds with parseable items.
  const feeds = [
    "https://www.anthropic.com/engineering/rss.xml",
    "https://www.anthropic.com/rss.xml",
  ];
  try {
    for (const url of feeds) {
      let res: Response;
      try {
        res = await fetchWithTimeout(url);
      } catch {
        continue; // this candidate feed didn't respond — try the next
      }
      if (!res.ok) continue;
      const xml = await res.text();
      // Accept either RSS 2.0 <item> or Atom <entry>.
      const rss = parseRssItems(xml);
      const parsed = rss.length
        ? rss
        : parseAtomEntries(xml).map((e) => ({
            title: e.title,
            link: e.link,
            date: e.date,
            desc: e.html ? stripHtml(e.html) : "",
          }));
      if (!parsed.length) continue;
      const cutoff = Date.now() - 45 * DAY;
      const items: DigestItem[] = [];
      for (const p of parsed) {
        const ts = p.date ? Date.parse(p.date) : NaN;
        if (!Number.isNaN(ts) && ts < cutoff) continue;
        items.push(
          item({
            source: label,
            sourceKey: "anthropic-eng",
            title: p.title,
            url: p.link,
            date: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
            category: "technique",
            summary: p.desc ? clip(p.desc, 220) : undefined,
          }),
        );
      }
      if (items.length) {
        items.sort((a, b) => b.sortTs - a.sortTs);
        return ok("anthropic-eng", label, items.slice(0, 20));
      }
    }
    return fail("anthropic-eng", label, "no engineering RSS/Atom feed responded with items");
  } catch (e) {
    return fail("anthropic-eng", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 14. TLDR AI newsletter (RSS 2.0) — broad AI headlines                */
/* ------------------------------------------------------------------ */

async function pullTldrAi(): Promise<Pulled> {
  const label = "TLDR AI";
  try {
    const res = await fetchWithTimeout("https://tldr.tech/api/rss/ai");
    if (!res.ok) return fail("tldr", label, `Feed responded ${res.status}`);
    const parsed = parseRssItems(await res.text());
    const cutoff = Date.now() - 21 * DAY;
    const items: DigestItem[] = [];
    for (const p of parsed.slice(0, 25)) {
      const ts = p.date ? Date.parse(p.date) : NaN;
      if (!Number.isNaN(ts) && ts < cutoff) continue;
      items.push(
        item({
          source: label,
          sourceKey: "tldr",
          title: p.title,
          url: p.link,
          date: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
          category: "ai-news",
          summary: p.desc ? clip(p.desc, 240) : undefined,
        }),
      );
    }
    return ok("tldr", label, items);
  } catch (e) {
    return fail("tldr", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 10. Reddit (RSS) — r/ClaudeAI + r/ClaudeCode                         */
/* ------------------------------------------------------------------ */

const REDDIT_FEEDS = [
  { url: "https://www.reddit.com/r/ClaudeAI/.rss", sub: "r/ClaudeAI" },
  { url: "https://www.reddit.com/r/ClaudeCode/.rss", sub: "r/ClaudeCode" },
];

async function pullReddit(): Promise<Pulled> {
  // Reddit's .json path is OAuth-gated from most networks; the public .rss
  // (Atom) feeds are far more reliable. Each entry carries an HTML <content>
  // body which we keep as `discussion` so the enrichment step can read the
  // vibe of the thread. Any single feed failing must not sink the rest.
  const label = "Reddit (r/ClaudeAI + r/ClaudeCode)";
  try {
    const cutoff = Date.now() - 21 * DAY;
    const results = await Promise.allSettled(
      REDDIT_FEEDS.map((f) =>
        fetchWithTimeout(f.url, { headers: { Accept: "application/atom+xml" } }),
      ),
    );
    const byId = new Map<string, DigestItem>();
    let anyOk = false;
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status !== "fulfilled" || !res.value.ok) continue;
      anyOk = true;
      const sub = REDDIT_FEEDS[i].sub;
      const entries = parseAtomEntries(await res.value.text());
      for (const e of entries) {
        const ts = e.date ? Date.parse(e.date) : NaN;
        if (!Number.isNaN(ts) && ts < cutoff) continue;
        // Drop the pinned megathread boilerplate — pure noise, no real signal.
        if (/megathread|please choose one of the following/i.test(`${e.title} ${e.html}`)) continue;
        const snippet = e.html ? clip(stripHtml(e.html), 500) : "";
        const it = item({
          source: sub,
          sourceKey: "reddit",
          title: e.title,
          url: e.link,
          date: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
          category: "community",
          summary: `Discussion on ${sub}`,
          discussionUrl: e.link,
          discussion: snippet.length >= 40 ? [snippet] : undefined,
        });
        byId.set(it.id, it);
      }
    }
    if (!anyOk) {
      // Graceful degrade — Reddit blocking/rate-limiting must never break the digest.
      return fail("reddit", label, "both Reddit RSS feeds failed (often rate-limited without OAuth)");
    }
    const items = [...byId.values()].sort((a, b) => b.sortTs - a.sortTs).slice(0, 25);
    return ok("reddit", label, items);
  } catch (e) {
    return fail("reddit", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* 15. GitHub Discussions (anthropics/claude-code) — pulse of usage     */
/* ------------------------------------------------------------------ */

type GhDiscussion = {
  title?: string;
  url?: string;
  updatedAt?: string;
  bodyText?: string;
  category?: { name?: string } | null;
};

async function pullClaudeCodeDiscussions(): Promise<Pulled> {
  const label = "Claude Code discussions";
  // GitHub's GraphQL API requires auth — reuse the file's token helper and
  // degrade gracefully (no throw) when no token is configured.
  const headers = githubHeaders();
  if (!headers.Authorization) {
    return fail("discussions", label, "no GITHUB_TOKEN — GitHub GraphQL requires auth");
  }
  const query = `query {
    repository(owner: "anthropics", name: "claude-code") {
      discussions(first: 15, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes { title url updatedAt bodyText category { name } }
      }
    }
  }`;
  try {
    const res = await fetchWithTimeout("https://api.github.com/graphql", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return fail("discussions", label, `GraphQL responded ${res.status}`);
    const data = (await res.json()) as {
      data?: { repository?: { discussions?: { nodes?: GhDiscussion[] } } };
      errors?: { message?: string }[];
    };
    if (data.errors?.length) {
      return fail("discussions", label, data.errors[0]?.message ?? "GraphQL error");
    }
    const nodes = data.data?.repository?.discussions?.nodes ?? [];
    const items: DigestItem[] = [];
    for (const n of nodes) {
      if (!n?.title || !n.url) continue;
      const body = n.bodyText ? clip(n.bodyText, 500) : "";
      const cat = n.category?.name;
      items.push(
        item({
          source: label,
          sourceKey: "discussions",
          title: cat ? `${n.title} — ${cat}` : n.title,
          url: n.url,
          date: n.updatedAt ?? null,
          category: "community",
          summary: "Discussion in anthropics/claude-code",
          discussionUrl: n.url,
          discussion: body.length >= 40 ? [body] : undefined,
        }),
      );
    }
    items.sort((a, b) => b.sortTs - a.sortTs);
    return ok("discussions", label, items);
  } catch (e) {
    return fail("discussions", label, e instanceof Error ? e.message : "fetch failed");
  }
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Every registered fetcher. The key/label are repeated here (each fetcher also
 * reports them in its own SourceStatus) for one reason only: a source that
 * blows the time budget below has produced no status of its own, and we'd
 * rather say "skipped" than let it vanish from the status strip.
 */
const FETCHERS: { key: string; label: string; run: () => Promise<Pulled> }[] = [
  { key: "releases", label: "Claude Code releases", run: pullClaudeCodeReleases },
  { key: "mcp", label: "MCP registry", run: pullMcpRegistry },
  { key: "awesome", label: "awesome-claude-code", run: pullAwesomeClaudeCode },
  { key: "hn", label: "Hacker News", run: pullHackerNews },
  { key: "news", label: "Anthropic news", run: pullAnthropicNews },
  { key: "alphasignal", label: "AlphaSignal", run: pullAlphaSignal },
  { key: "simonw", label: "Simon Willison", run: pullSimonWillison },
  { key: "anthropic-eng", label: "Anthropic Engineering", run: pullAnthropicEngineering },
  { key: "tldr", label: "TLDR AI", run: pullTldrAi },
  { key: "reddit", label: "Reddit (r/ClaudeAI + r/ClaudeCode)", run: pullReddit },
  { key: "discussions", label: "Claude Code discussions", run: pullClaudeCodeDiscussions },
];

/**
 * Pull every source in parallel. Never throws — failures become statuses.
 *
 * Every fetcher reads a *fixed* window (24h–45d, see docs/reporter-sources.md);
 * there is no per-source cursor, so each pull re-reads its whole window and the
 * merge in lib/reporter.ts dedupes. That's deliberate: the digest cache is
 * best-effort (see lib/reporter-store.ts) and a fixed window is self-healing.
 *
 * `budgetMs`, when given, caps the whole fan-out: any source still running when
 * the budget expires is reported as skipped (its own request keeps running to
 * its own fetch timeout, we just stop waiting). Used by the cold-start path in
 * lib/reporter.ts, which has to answer a live request quickly.
 */
export async function pullAllSources(
  opts: { budgetMs?: number } = {},
): Promise<{
  items: DigestItem[];
  sources: SourceStatus[];
}> {
  const { budgetMs } = opts;
  const results = await Promise.all(
    FETCHERS.map(({ key, label, run }) => {
      const pull = run();
      if (!budgetMs) return pull;
      return new Promise<Pulled>((resolve) => {
        const timer = setTimeout(
          () => resolve(fail(key, label, "skipped — slower than the refresh budget")),
          budgetMs,
        );
        pull.then(
          (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          (e) => {
            clearTimeout(timer);
            resolve(fail(key, label, e instanceof Error ? e.message : "fetch failed"));
          },
        );
      });
    }),
  );
  const items = results.flatMap((r) => r.items);
  const sources = results.map((r) => r.status);
  return { items, sources };
}
