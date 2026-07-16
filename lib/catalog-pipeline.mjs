/**
 * Catalog ingestion pipeline (pure ESM, no framework deps).
 *
 * ONE canonical pipeline used by BOTH:
 *   - scripts/build-catalog.mjs  (writes config/tool-catalog.json for the committed catalog)
 *   - app/api/tools/catalog/refresh/route.ts  (live "Scan for new tools" button)
 *
 * It pulls from the live-verified core sources, filters for quality, joins to
 * GitHub for popularity/staleness, normalizes everything into the catalog entry
 * shape, dedupes by repo/package URL, ranks, and marks a "Recommended" pick per
 * category. Only Node built-ins + global fetch — no new packages, no Octokit.
 *
 * Every source degrades gracefully: a source that errors or times out simply
 * contributes zero entries and the rest of the build continues.
 */

/* ------------------------------------------------------------------ */
/* Small fetch helpers with retry (PulseMCP v0beta randomly 200-fails   */
/* during its sunset, so retries are mandatory, not optional).          */
/* ------------------------------------------------------------------ */

const noop = () => {};

async function fetchJson(url, { timeoutMs = 15000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();
  // PulseMCP returns HTTP 200 with an { error } body when it randomly sunset-fails.
  if (data && data.error) throw new Error(`api error: ${data.error.code || "unknown"}`);
  return data;
}

async function fetchJsonRetry(url, { retries = 6, timeoutMs = 15000, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchJson(url, { timeoutMs, headers });
    } catch (err) {
      lastErr = err;
      // brief backoff between tries
      await new Promise((r) => setTimeout(r, 250 + attempt * 250));
    }
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ */
/* URL / string utilities                                              */
/* ------------------------------------------------------------------ */

/** Normalize a repo/package URL to a stable dedupe key (owner/repo for GitHub). */
export function normalizeKey(url) {
  if (!url) return "";
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^https?:\/\//, "").replace(/^www\./, "");
  u = u.replace(/\.git$/, "").replace(/\/+$/, "");
  // github.com/owner/repo/tree/... -> github.com/owner/repo
  const gh = u.match(/^github\.com\/([^/]+)\/([^/]+)/);
  if (gh) return `github.com/${gh[1]}/${gh[2]}`;
  return u;
}

/** owner/repo from a GitHub url, or null. */
function githubOwnerRepo(url) {
  if (!url) return null;
  const m = String(url).match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function titleize(s) {
  return String(s || "")
    .replace(/\.(json|md|ya?ml)$/i, "")
    .split("/")
    .pop()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-US");
}

/** Is a description real (not empty / junk)? */
function isRealDescription(d) {
  const t = String(d || "").trim();
  if (t.length < 20) return false;
  if (/^(todo|tbd|n\/a|test|placeholder|wip)\.?$/i.test(t)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Category inference + safety flags (plain English)                   */
/* ------------------------------------------------------------------ */

const CATEGORY_RULES = [
  ["Payments & commerce", /\b(payment|billing|invoice|stripe|paypal|checkout|purchase|commerce|shopify|crypto|wallet|trading|finance)\b/i],
  ["Databases", /\b(database|postgres|mysql|mongo|sqlite|sql|redis|supabase|firestore|bigquery|snowflake|prisma|db)\b/i],
  ["Web search & scraping", /\b(search|scrape|crawl|browse|web ?page|serp|firecrawl|tavily|brave|google)\b/i],
  ["Browser & automation", /\b(browser|playwright|puppeteer|selenium|automation|automate|click|navigate)\b/i],
  ["Communication", /\b(slack|discord|email|gmail|telegram|whatsapp|message|chat|sms|twilio)\b/i],
  ["Design & media", /\b(figma|design|image|video|audio|photo|canva|render|3d|blender|elevenlabs|voice)\b/i],
  ["Cloud & infra", /\b(aws|azure|gcp|cloudflare|kubernetes|docker|terraform|deploy|server|infra|vercel|netlify)\b/i],
  ["Dev tools", /\b(git|github|gitlab|code|lint|test|debug|ci\/?cd|npm|build|compiler|ide|api)\b/i],
  ["Productivity & docs", /\b(notion|confluence|jira|linear|asana|trello|calendar|todo|task|document|docs|sheet|excel|word|pdf|note)\b/i],
  ["Monitoring & errors", /\b(sentry|datadog|monitor|log|observability|error|alert|metric|trace)\b/i],
  ["Security", /\b(security|vulnerab|auth|secret|encrypt|scan|owasp|pentest|compliance)\b/i],
  ["AI & data", /\b(ai|llm|embedding|vector|rag|model|ml|analytics|data)\b/i],
];

function inferCategory(text) {
  const hay = String(text || "");
  for (const [cat, re] of CATEGORY_RULES) if (re.test(hay)) return cat;
  return "Other";
}

/**
 * Plain-English safety flags shown in red on the card. Returns [] when nothing
 * risky is detected.
 */
function safetyFlags(text, { authMethod } = {}) {
  const hay = String(text || "");
  // Don't flag "needs a key" when the text explicitly says it doesn't.
  const saysNoKey =
    /\b(no api[ -]?key|without an? (api[ -]?key|account)|no account|no extra account|no setup|works out of the box|keyless|no key needed|runs locally)\b/i.test(hay);
  const flags = [];
  const needsKey =
    !saysNoKey &&
    ((authMethod && /oauth|api_key|token|bearer/i.test(authMethod)) ||
      /\b(api[ -]?key|access token|oauth|credential|secret key|sign in|authenticat)\b/i.test(hay));
  if (needsKey) flags.push("Needs an API key or account login — you'll be asked for it.");
  if (/\b(payment|billing|invoice|charge|purchase|checkout|refund|money|wallet|trading|transfer funds)\b/i.test(hay))
    flags.push("Can spend money or move funds — double-check before you use it.");
  if (/\b(delete|remove|drop table|overwrite|write file|deploy|run command|execute|shell|terminal|filesystem|file system)\b/i.test(hay))
    flags.push("Can change, delete, or run things on your systems.");
  return flags;
}

/* ------------------------------------------------------------------ */
/* Source pulls                                                        */
/* ------------------------------------------------------------------ */

/** 1. PulseMCP — 22k MCP servers. Filter: stars>=10 OR weekly downloads>=500. */
export async function pullPulseMcp({ pages = 10, log = noop } = {}) {
  const out = [];
  let offset = 0;
  for (let p = 0; p < pages; p++) {
    const url = `https://api.pulsemcp.com/v0beta/servers?count_per_page=100&offset=${offset}`;
    let data;
    try {
      data = await fetchJsonRetry(url, { retries: 8, timeoutMs: 15000 });
    } catch (err) {
      log(`  pulsemcp page ${p + 1} failed: ${err.message}`);
      break; // stop paging on hard failure, keep what we have
    }
    const servers = Array.isArray(data.servers) ? data.servers : [];
    for (const s of servers) {
      const stars = s.github_stars || 0;
      const downloads = s.package_download_count || 0;
      if (stars < 10 && downloads < 500) continue;
      const desc = s.short_description || s.EXPERIMENTAL_ai_generated_description || "";
      if (!isRealDescription(desc)) continue;
      const installUrl = s.source_code_url || s.external_url || s.remotes?.[0]?.url_direct || s.url;
      if (!installUrl) continue;
      out.push({
        source: "pulsemcp",
        type: "mcp",
        name: (s.name || "").trim() || titleize(s.package_name || installUrl),
        description: desc.trim(),
        url: installUrl,
        githubUrl: s.source_code_url || null,
        stars,
        downloads,
        packageRegistry: s.package_registry || null,
        packageName: s.package_name || null,
        authMethod: s.remotes?.[0]?.authentication_method || null,
        keywords: [],
      });
    }
    log(`  pulsemcp page ${p + 1}: ${servers.length} raw, running total kept ${out.length}`);
    if (!data.next) break;
    offset += 100;
  }
  return out;
}

/** 2. davila7 aggregate — skills/agents/mcps/commands/hooks in one file. */
export async function pullDavila7({ log = noop, minDownloads = 5 } = {}) {
  const base = "https://raw.githubusercontent.com/davila7/claude-code-templates/main/docs/components.json";
  let data;
  try {
    data = await fetchJsonRetry(base, { retries: 3, timeoutMs: 20000 });
  } catch (err) {
    log(`  davila7 failed: ${err.message}`);
    return [];
  }
  // Map davila7 arrays -> our three tool types. We deliberately skip its
  // `commands`/`hooks` (niche Claude Code snippets) so they don't crowd out the
  // far richer MCP-server ecosystem in the capped catalog.
  const typeMap = { skills: "skill", agents: "skill", mcps: "mcp" };
  const out = [];
  for (const [arr, ttype] of Object.entries(typeMap)) {
    const items = Array.isArray(data[arr]) ? data[arr] : [];
    for (const it of items) {
      const sec = it.security || {};
      // "clean security": no errors flagged by the aggregator's scanner.
      if ((sec.errorCount || 0) > 0) continue;
      const downloads = it.downloads || 0;
      if (downloads < minDownloads) continue;
      if (!isRealDescription(it.description)) continue;
      const path = it.path || "";
      const url = `https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/${path}`;
      out.push({
        source: "davila7",
        type: ttype,
        name: titleize(it.name || path),
        description: String(it.description).trim(),
        url,
        // Shared monorepo — per-component stars would be meaningless, so skip the
        // GitHub join (githubUrl:null) and give each component a unique dedupe key.
        githubUrl: null,
        dedupeKey: `davila7:${arr}:${slugify(path || it.name)}`,
        stars: 0,
        downloads,
        category: it.category ? titleize(it.category) : null,
        keywords: Array.isArray(it.keywords) ? it.keywords : [],
        davilaType: it.type || arr,
      });
    }
  }
  log(`  davila7: kept ${out.length}`);
  return out;
}

/** 3. Official Anthropic plugin marketplace — 255 curated plugins (verified→official). */
export async function pullOfficialPlugins({ log = noop } = {}) {
  const url = "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";
  let data;
  try {
    data = await fetchJsonRetry(url, { retries: 3, timeoutMs: 20000 });
  } catch (err) {
    log(`  official plugins failed: ${err.message}`);
    return [];
  }
  const plugins = Array.isArray(data.plugins) ? data.plugins : [];
  const out = [];
  for (const p of plugins) {
    if (!isRealDescription(p.description)) continue;
    const src = p.source?.url ? p.source.url.replace(/\.git$/, "") : null;
    const url2 = p.homepage || src;
    if (!url2) continue;
    out.push({
      source: "anthropic-plugins",
      type: "plugin",
      name: p.displayName || titleize(p.name),
      description: String(p.description).trim(),
      url: url2,
      // Many official plugins share one vendor repo, so key by plugin name.
      githubUrl: null,
      dedupeKey: `plugin:${slugify(p.name)}`,
      stars: 0,
      downloads: 0,
      category: p.category ? titleize(p.category) : null,
      keywords: Array.isArray(p.keywords) ? p.keywords : Array.isArray(p.tags) ? p.tags : [],
      official: true,
    });
  }
  log(`  official plugins: kept ${out.length}`);
  return out;
}

/** 4. Official Anthropic skills marketplace — verified tier. */
export async function pullOfficialSkills({ log = noop } = {}) {
  const url = "https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json";
  let data;
  try {
    data = await fetchJsonRetry(url, { retries: 3, timeoutMs: 20000 });
  } catch (err) {
    log(`  official skills failed: ${err.message}`);
    return [];
  }
  const plugins = Array.isArray(data.plugins) ? data.plugins : [];
  const out = [];
  for (const p of plugins) {
    if (!isRealDescription(p.description)) continue;
    out.push({
      source: "anthropic-skills",
      type: "skill",
      name: p.displayName || titleize(p.name),
      description: String(p.description).trim(),
      url: "https://github.com/anthropics/skills",
      githubUrl: null,
      dedupeKey: `askill:${slugify(p.name)}`,
      stars: 0,
      downloads: 0,
      category: "Productivity & docs",
      keywords: [],
      official: true,
    });
  }
  log(`  official skills: kept ${out.length}`);
  return out;
}

/** 5. Official MCP registry — authoritative namespace. Skip deleted/deprecated. */
export async function pullMcpRegistry({ pages = 5, log = noop } = {}) {
  const out = [];
  let cursor = "";
  for (let p = 0; p < pages; p++) {
    const url = `https://registry.modelcontextprotocol.io/v0/servers?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    let data;
    try {
      data = await fetchJsonRetry(url, { retries: 3, timeoutMs: 12000 });
    } catch (err) {
      log(`  mcp-registry page ${p + 1} failed: ${err.message}`);
      break;
    }
    const servers = Array.isArray(data.servers) ? data.servers : [];
    for (const entry of servers) {
      // Each item is wrapped: { server: {...}, _meta: {...} }.
      const s = entry.server || entry;
      const status =
        entry._meta?.["io.modelcontextprotocol.registry/official"]?.status ||
        s._meta?.["io.modelcontextprotocol.registry/official"]?.status ||
        s.official?.status;
      if (status === "deleted" || status === "deprecated") continue;
      // Install URL: prefer a source repo, else a hosted remote endpoint.
      const repoUrl = s.repository?.url?.trim();
      const remoteUrl = s.remotes?.[0]?.url?.trim();
      const installUrl = repoUrl || remoteUrl;
      if (!installUrl) continue;
      try { new URL(installUrl); } catch { continue; }
      const rawName = (s.title || s.name || "").trim();
      const shortName = rawName.split("/").pop() || rawName;
      if (!isRealDescription(s.description)) continue;
      out.push({
        source: "mcp-registry",
        type: "mcp",
        name: titleize(shortName),
        description: String(s.description).trim(),
        url: installUrl,
        githubUrl: repoUrl && repoUrl.includes("github.com") ? repoUrl : null,
        stars: 0,
        downloads: 0,
        authMethod: s.remotes?.[0]?.authentication_method || null,
        keywords: [],
        registryOfficial: !!status,
      });
    }
    const nextCursor = data.metadata?.nextCursor || data.metadata?.next_cursor;
    log(`  mcp-registry page ${p + 1}: ${servers.length} raw, total kept ${out.length}`);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* GitHub join — popularity + staleness (bounded)                      */
/* ------------------------------------------------------------------ */

/**
 * Fill stars + pushed_at for the given raw entries by hitting the GitHub repo
 * API. Bounded by `max` calls to respect rate limits and keep the build fast.
 * Mutates entries in place (sets `.stars` when better, `.pushedAt`). Degrades
 * per-call: a failed lookup just leaves the entry as-is.
 */
export async function githubJoin(entries, { token, max = 250, log = noop } = {}) {
  const headers = { accept: "application/vnd.github+json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const seen = new Map(); // owner/repo -> {stars, pushedAt}
  let calls = 0;
  for (const e of entries) {
    if (calls >= max) break;
    const gh = githubOwnerRepo(e.githubUrl || e.url);
    if (!gh) continue;
    const key = `${gh.owner}/${gh.repo}`.toLowerCase();
    if (seen.has(key)) {
      const c = seen.get(key);
      if (c) { e.stars = Math.max(e.stars || 0, c.stars); e.pushedAt = c.pushedAt; }
      continue;
    }
    calls++;
    try {
      const data = await fetchJsonRetry(`https://api.github.com/repos/${gh.owner}/${gh.repo}`, {
        retries: 2, timeoutMs: 10000, headers,
      });
      const info = { stars: data.stargazers_count || 0, pushedAt: data.pushed_at || null };
      seen.set(key, info);
      e.stars = Math.max(e.stars || 0, info.stars);
      e.pushedAt = info.pushedAt;
    } catch {
      seen.set(key, null);
    }
  }
  log(`  github join: ${calls} repo lookups`);
  return entries;
}

/* ------------------------------------------------------------------ */
/* Normalize -> CatalogEntry shape                                     */
/* ------------------------------------------------------------------ */

const NINE_MONTHS_MS = 9 * 30 * 24 * 60 * 60 * 1000;

function trustTierFor(raw) {
  // "Official" = genuinely first-party curated (Anthropic). The MCP registry is
  // authoritative but has NO popularity signal, so its entries join the community
  // pool and compete on cross-filled popularity rather than flooding the top tier.
  if (raw.source === "anthropic-plugins" || raw.source === "anthropic-skills") return "official";
  // Verified vendor proxy: an established, published tool with real traction.
  if ((raw.stars || 0) >= 300 && (raw.packageRegistry || raw.packageName)) return "verified";
  if ((raw.stars || 0) >= 1000) return "verified";
  return "community";
}

function plainGoodFor(raw) {
  const kw = (raw.keywords || []).slice(0, 3).map((k) => titleize(k));
  if (kw.length) return kw.map((k) => `Helps with ${k.toLowerCase()}`);
  const cat = raw.category || inferCategory(`${raw.name} ${raw.description}`);
  return [`Useful for ${cat.toLowerCase()} tasks`, "Open the link to see the full details"];
}

function plainFeatures(raw) {
  const feats = [];
  if (raw.type === "mcp") feats.push("Connects Claude to an outside service or data source");
  if (raw.type === "skill") feats.push("Adds a ready-made capability to Claude");
  if (raw.type === "plugin") feats.push("Bundles commands/skills you can install at once");
  if (raw.packageRegistry) feats.push(`Published on ${raw.packageRegistry}`);
  if (raw.stars >= 10) feats.push(`${fmtNum(raw.stars)} GitHub stars`);
  return feats.slice(0, 4);
}

function popularityText(raw) {
  if (raw.source === "anthropic-plugins") return "Official Anthropic plugin (curated marketplace).";
  if (raw.source === "anthropic-skills") return "Official Anthropic skill.";
  if (raw.source === "mcp-registry" && raw.registryOfficial) return "Listed in the official MCP registry.";
  const bits = [];
  if (raw.stars >= 10) bits.push(`${fmtNum(raw.stars)} GitHub stars`);
  if (raw.downloads >= 1) bits.push(`${fmtNum(raw.downloads)} downloads`);
  return bits.length ? bits.join(" · ") : "Community tool.";
}

function requirementsText(flags, raw) {
  if (flags.some((f) => f.includes("API key")))
    return "Needs an API key or account login — you'll be asked to add it after install.";
  if (raw.source === "anthropic-plugins" || raw.source === "anthropic-skills")
    return "No setup — install from Anthropic's official marketplace.";
  return "No API key needed for basic use — open the link to confirm.";
}

function normalize(raw, today) {
  const text = `${raw.name} ${raw.description} ${(raw.keywords || []).join(" ")}`;
  // Always map to ONE consistent category taxonomy (feeding the source's own
  // category label in as a hint) so the category filter stays clean and
  // "Recommended" means one clear best pick per category.
  const category = inferCategory(`${raw.category || ""} ${text}`);
  const flags = safetyFlags(text, { authMethod: raw.authMethod });
  const tier = trustTierFor(raw);
  const official = tier === "official";
  // staleness: only flag when we actually have a pushed_at older than 9 months
  let stale = false;
  let staleReason;
  if (raw.pushedAt) {
    const age = today - new Date(raw.pushedAt).getTime();
    if (age > NINE_MONTHS_MS) {
      stale = true;
      staleReason = `Last updated ${new Date(raw.pushedAt).toISOString().slice(0, 10)} — may be unmaintained.`;
    }
  }
  const flagsFinal = flags.slice();
  const goodFor = plainGoodFor({ ...raw, category });
  return {
    id: `${raw.source}-${slugify(raw.name) || slugify(raw.url)}`,
    name: raw.name,
    type: raw.type,
    status: "unreviewed",
    url: raw.url,
    description: raw.description,
    goodFor,
    features: plainFeatures(raw),
    requirements: requirementsText(flagsFinal, raw),
    popularity: popularityText(raw),
    lastVerified: today ? new Date(today).toISOString().slice(0, 10) : "",
    discoveredFrom: raw.source,
    // extended fields
    trustTier: tier,
    rankScore: 0, // filled after normalization pool is known
    stale,
    staleReason,
    categories: [category],
    safetyFlags: flagsFinal,
    source: raw.source,
    recommended: false,
    _stars: raw.stars || 0,
    _downloads: raw.downloads || 0,
    _official: official || tier === "verified",
    _key: raw.dedupeKey || normalizeKey(raw.githubUrl || raw.url) || `id:${raw.source}:${slugify(raw.name)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Rank + dedupe + recommend                                           */
/* ------------------------------------------------------------------ */

function rankAll(entries) {
  const maxLogStars = Math.max(1, ...entries.map((e) => Math.log10(1 + (e._stars || 0))));
  const maxLogDl = Math.max(1, ...entries.map((e) => Math.log10(1 + (e._downloads || 0))));
  for (const e of entries) {
    const nStars = Math.log10(1 + (e._stars || 0)) / maxLogStars;
    const nDl = Math.log10(1 + (e._downloads || 0)) / maxLogDl;
    const bonus = e._official ? 0.2 : 0;
    e.rankScore = Math.round((nStars * 0.4 + nDl * 0.4 + bonus) * 1000) / 1000;
  }
  return entries;
}

const TIER_WEIGHT = { official: 3, verified: 2, community: 1, unreviewed: 0 };

/** Dedupe by normalized repo/package key; keep the strongest, merge categories. */
function dedupe(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const k = e._key;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, e); continue; }
    const better =
      TIER_WEIGHT[e.trustTier] > TIER_WEIGHT[prev.trustTier] ||
      (TIER_WEIGHT[e.trustTier] === TIER_WEIGHT[prev.trustTier] && e.rankScore > prev.rankScore);
    const keep = better ? e : prev;
    const drop = better ? prev : e;
    // merge categories
    keep.categories = Array.from(new Set([...keep.categories, ...drop.categories]));
    byKey.set(k, keep);
  }
  return Array.from(byKey.values());
}

/** Mark the single highest-ranked (tier-preferred), non-stale entry per category as Recommended. */
function markRecommended(entries) {
  const bestByCat = new Map();
  for (const e of entries) {
    if (e.stale) continue;
    const cat = e.categories[0];
    const cur = bestByCat.get(cat);
    const score = TIER_WEIGHT[e.trustTier] * 10 + e.rankScore;
    if (!cur || score > cur.score) bestByCat.set(cat, { e, score });
  }
  for (const { e } of bestByCat.values()) e.recommended = true;
  return entries;
}

/* ------------------------------------------------------------------ */
/* Seed enrichment (never clobber the 26 hand-reviewed entries)        */
/* ------------------------------------------------------------------ */

export function enrichSeed(seedEntries, today) {
  void today;
  return seedEntries.map((e) => {
    // Only the hand-authored fields are trusted; ALL derived fields are
    // recomputed every build so re-reading generated output stays idempotent.
    const {
      trustTier: _t, rankScore: _r, stale: _s, staleReason: _sr,
      categories: _c, safetyFlags: _sf, recommended: _rec, source: _src,
      ...hand
    } = e;
    void _t; void _r; void _s; void _sr; void _c; void _sf; void _rec; void _src;
    const text = `${hand.name} ${hand.description} ${hand.requirements} ${(hand.features || []).join(" ")}`;
    const isOfficial = /official/i.test(hand.popularity || "");
    return {
      ...hand,
      status: hand.status || "reviewed",
      trustTier: isOfficial ? "official" : "verified",
      rankScore: 0.85, // hand-reviewed => surfaces near the top
      stale: false,
      categories: [inferCategory(text)],
      safetyFlags: safetyFlags(text),
      source: "seed",
      recommended: false,
      _key: normalizeKey(hand.url) || `seed:${hand.id}`,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Run the whole pipeline. Returns { candidates, stats } where candidates are
 * normalized+ranked entries from the auto sources (NOT including the seed; the
 * caller merges seed + these). `githubMax` bounds the staleness join.
 *
 * @param {object} opts
 * @param {string} [opts.token] GitHub token for the popularity/staleness join.
 * @param {number} [opts.pulsePages] PulseMCP pages to pull (100 each).
 * @param {number} [opts.registryPages]
 * @param {number} [opts.githubMax] max GitHub repo lookups.
 * @param {number} [opts.davilaMinDownloads] min downloads to keep a davila7 component.
 * @param {(m:string)=>void} [opts.log]
 * @param {number} [opts.now] epoch ms (for deterministic tests).
 */
export async function runPipeline({
  token,
  pulsePages = 10,
  registryPages = 5,
  githubMax = 250,
  davilaMinDownloads = 5,
  log = noop,
  now = Date.now(),
} = {}) {
  const stats = { sources: {} };

  const [pulse, davila, plugins, skills, registry] = await Promise.all([
    pullPulseMcp({ pages: pulsePages, log }).catch(() => []),
    pullDavila7({ log, minDownloads: davilaMinDownloads }).catch(() => []),
    pullOfficialPlugins({ log }).catch(() => []),
    pullOfficialSkills({ log }).catch(() => []),
    pullMcpRegistry({ pages: registryPages, log }).catch(() => []),
  ]);

  stats.sources = {
    pulsemcp: pulse.length,
    davila7: davila.length,
    "anthropic-plugins": plugins.length,
    "anthropic-skills": skills.length,
    "mcp-registry": registry.length,
  };

  let raw = [...pulse, ...davila, ...plugins, ...skills, ...registry];

  // GitHub join for staleness+fresh stars, prioritizing community entries with a
  // repo (official/verified curated sources don't need it). Bounded by githubMax.
  if (githubMax > 0 && token) {
    const joinTargets = raw
      .filter((r) => r.githubUrl && r.source !== "anthropic-plugins" && r.source !== "anthropic-skills")
      .sort((a, b) => (b.stars || 0) + (b.downloads || 0) - ((a.stars || 0) + (a.downloads || 0)));
    await githubJoin(joinTargets, { token, max: githubMax, log });
  }

  let entries = raw.map((r) => normalize(r, now));
  entries = dedupe(entries);
  entries = rankAll(entries);

  stats.totalCandidates = entries.length;
  return { candidates: entries, stats };
}

/**
 * Assemble the final committed catalog: seed (kept, never clobbered) + ranked
 * auto candidates, deduped across both, capped, with Recommended marks.
 *
 * @returns {{ entries: any[], stats: object }}
 */
export function assembleCatalog(seedEnriched, candidates, { cap = 450 } = {}) {
  // dedupe candidates against seed keys (seed always wins)
  const seedKeys = new Set(seedEnriched.map((e) => e._key));
  const fresh = candidates.filter((c) => !seedKeys.has(c._key));

  // Always keep official + verified; fill remaining budget with top community.
  const mustKeep = fresh.filter((e) => e.trustTier === "official" || e.trustTier === "verified");
  const budget = Math.max(0, cap - seedEnriched.length - mustKeep.length);

  // Balance the community fill across the three tool types via round-robin over
  // each type's rank-sorted list, so skills/plugins aren't crowded out by the
  // many high-star MCP servers. Non-stale entries are preferred first.
  const community = fresh.filter((e) => e.trustTier === "community");
  const buckets = { mcp: [], skill: [], plugin: [] };
  for (const e of community) (buckets[e.type] || (buckets[e.type] = [])).push(e);
  const rankSort = (a, b) => Number(a.stale) - Number(b.stale) || b.rankScore - a.rankScore;
  for (const k of Object.keys(buckets)) buckets[k].sort(rankSort);

  const keptCommunity = [];
  const order = ["skill", "plugin", "mcp"]; // start with the scarcer types
  let idx = 0;
  while (keptCommunity.length < budget) {
    let progressed = false;
    for (const t of order) {
      if (keptCommunity.length >= budget) break;
      const next = buckets[t][idx];
      if (next) { keptCommunity.push(next); progressed = true; }
    }
    if (!progressed) break; // all buckets exhausted
    idx++;
  }

  let all = [...seedEnriched, ...mustKeep, ...keptCommunity];
  all = markRecommended(all);

  // sort for a sensible default order: recommended first, then tier, then rank
  all.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    const tw = TIER_WEIGHT[b.trustTier] - TIER_WEIGHT[a.trustTier];
    if (tw) return tw;
    return b.rankScore - a.rankScore;
  });

  // guarantee unique ids (two davila7 components can slugify to the same id)
  const idSeen = new Map();
  for (const e of all) {
    let id = e.id;
    if (idSeen.has(id)) {
      const n = idSeen.get(id) + 1;
      idSeen.set(id, n);
      id = `${id}-${n}`;
    }
    idSeen.set(e.id, idSeen.get(e.id) || 1);
    e.id = id;
  }

  // strip internal underscore fields before persisting
  const clean = all.map(stripInternal);

  const byType = {};
  const byTier = {};
  for (const e of clean) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byTier[e.trustTier] = (byTier[e.trustTier] || 0) + 1;
  }
  return { entries: clean, stats: { total: clean.length, byType, byTier } };
}

export function stripInternal(e) {
  const { _stars, _downloads, _official, _key, ...rest } = e;
  void _stars; void _downloads; void _official; void _key;
  return rest;
}
