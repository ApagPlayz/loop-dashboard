"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  X,
  Server,
  Sparkles,
  Puzzle,
  CheckCircle2,
  ExternalLink,
  Wrench,
  AlertTriangle,
  Star,
  ShieldCheck,
  BadgeCheck,
  Users,
  HelpCircle,
} from "lucide-react";

/**
 * The one tool-catalog browser, used by two hosts:
 *  - the Tools tab's "Browse the marketplace" modal  → install context {mode:"all"}
 *  - a Process-Map agent modal's "Install tools" tab → {mode:"agent", ...}
 *
 * Search + type/category filters + trust badges/safety flags + detail view are
 * identical in both places. Only the install action differs: the Tools tab
 * always installs for ALL agents (with a hint pointing to the map for a single
 * agent); the map tab installs for THAT one agent and is project-aware.
 */

/* ---------- types (mirror lib/tool-catalog.ts) ---------- */

type ToolType = "mcp" | "skill" | "plugin";
type ToolStatus = "reviewed" | "unreviewed";
type TrustTier = "official" | "verified" | "community" | "unreviewed";

type CatalogEntry = {
  id: string;
  name: string;
  type: ToolType;
  status: ToolStatus;
  url: string;
  description: string;
  goodFor: string[];
  features: string[];
  requirements: string;
  popularity: string;
  lastVerified: string;
  discoveredFrom?: string;
  trustTier?: TrustTier;
  rankScore?: number;
  stale?: boolean;
  staleReason?: string;
  categories?: string[];
  safetyFlags?: string[];
  source?: string;
  recommended?: boolean;
};

/** Where an install from this browser should go. */
export type InstallContext =
  | { mode: "all" }
  | {
      mode: "agent";
      agentId: string;
      agentLabel: string;
      project: string;
      /** Whether this project's repo has the tool-installer workflow. */
      available: boolean;
    };

const MAP_HINT = "Want it on just one agent? Open that agent on the Process Map → Install tools tab.";

/* ---------- type styling ---------- */

const TYPE_META: Record<ToolType, { label: string; chip: string; icon: React.ReactNode }> = {
  mcp: { label: "MCP server", chip: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: <Server className="h-3.5 w-3.5" /> },
  skill: { label: "Skill", chip: "border-violet-500/30 bg-violet-500/10 text-violet-300", icon: <Sparkles className="h-3.5 w-3.5" /> },
  plugin: { label: "Plugin", chip: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: <Puzzle className="h-3.5 w-3.5" /> },
};

/* ---------- trust tiers (plain English) ---------- */

const TIER_META: Record<TrustTier, { label: string; help: string; chip: string; icon: React.ReactNode }> = {
  official: { label: "Official", help: "Made by Anthropic or listed in the official registry.", chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: <ShieldCheck className="h-3 w-3" /> },
  verified: { label: "Verified vendor", help: "An established, popular tool from a known publisher.", chip: "border-sky-500/40 bg-sky-500/10 text-sky-300", icon: <BadgeCheck className="h-3 w-3" /> },
  community: { label: "Community", help: "Open-source community tool with decent usage signals.", chip: "border-zinc-600 bg-zinc-800/60 text-zinc-300", icon: <Users className="h-3 w-3" /> },
  unreviewed: { label: "New · unreviewed", help: "Found automatically — nobody has checked it yet.", chip: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: <HelpCircle className="h-3 w-3" /> },
};

function tierOf(e: CatalogEntry): TrustTier {
  if (e.trustTier) return e.trustTier;
  return e.status === "reviewed" ? "verified" : "unreviewed";
}

const FILTERS: { value: "all" | ToolType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mcp", label: "MCP servers" },
  { value: "skill", label: "Skills" },
  { value: "plugin", label: "Plugins" },
];

const PAGE_SIZE = 24;

/* ================================================================== */

export default function CatalogBrowser({ install = { mode: "all" } }: { install?: InstallContext }) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | ToolType>("all");
  const [category, setCategory] = useState<string>("all");
  const [showStale, setShowStale] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/tools/catalog", { cache: "no-store" });
      const d = await r.json();
      setEntries(d.entries ?? []);
      setRequestedIds(new Set<string>(d.requestedIds ?? []));
    } catch {
      // leave empty
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function scan() {
    setScanning(true);
    setScanMsg(null);
    try {
      const r = await fetch("/api/tools/catalog/refresh", { method: "POST" });
      const d = await r.json();
      if (r.ok) {
        setScanMsg(
          d.addedCount > 0
            ? `Found ${d.addedCount} new tool${d.addedCount === 1 ? "" : "s"} — added below and marked "new, unreviewed".`
            : "Scan finished — nothing new since last time.",
        );
        await load();
      } else {
        setScanMsg("Scan didn't complete. Please try again.");
      }
    } catch {
      setScanMsg("Scan didn't complete. Please try again.");
    } finally {
      setScanning(false);
    }
  }

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) for (const c of e.categories ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [entries]);

  const staleCount = useMemo(() => entries.filter((e) => e.stale).length, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!showStale && e.stale) return false;
      if (filter !== "all" && e.type !== filter) return false;
      if (category !== "all" && !(e.categories ?? []).includes(category)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.categories ?? []).some((c) => c.toLowerCase().includes(q)) ||
        e.goodFor.some((g) => g.toLowerCase().includes(q)) ||
        e.features.some((f) => f.toLowerCase().includes(q))
      );
    });
  }, [entries, query, filter, category, showStale]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [query, filter, category, showStale]);

  const counts = useMemo(() => {
    const c = { mcp: 0, skill: 0, plugin: 0 };
    for (const e of entries) if (!e.stale) c[e.type]++;
    return c;
  }, [entries]);

  const shown = filtered.slice(0, visible);

  return (
    <div>
      {/* Intro / install-target context */}
      {install.mode === "agent" ? (
        <p className="mb-3 text-xs text-zinc-400">
          Browse the whole tool library and install straight into{" "}
          <span className="font-medium text-zinc-200">{install.agentLabel}</span>. Tap a tool to see
          what it does.
          {entries.length > 0 && (
            <span className="ml-1 text-zinc-500">
              {counts.mcp} MCP · {counts.skill} skills · {counts.plugin} plugins.
            </span>
          )}
        </p>
      ) : (
        <p className="mb-3 text-xs text-zinc-400">
          Hundreds of MCP servers, skills, and plugins, ranked by how popular and well-maintained they
          are. Tap one to see what it does, then install it for all your agents.
          {entries.length > 0 && (
            <span className="ml-1 text-zinc-500">
              {counts.mcp} MCP · {counts.skill} skills · {counts.plugin} plugins.
            </span>
          )}
        </p>
      )}

      {/* Search + scan */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools (e.g. browser, database, search)…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2.5 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning…" : "Scan for new tools"}
        </button>
      </div>

      {scanMsg && <p className="mt-2 text-xs text-emerald-300">{scanMsg}</p>}

      {/* Type filters */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Category filter + stale toggle */}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {staleCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={showStale}
              onChange={(e) => setShowStale(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-950 accent-emerald-500"
            />
            Show unmaintained tools ({staleCount})
          </label>
        )}
      </div>

      {/* List */}
      <div className="mt-4">
        {!loaded ? (
          <p className="text-sm text-zinc-500">Loading catalog…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-zinc-500">No tools match your search.</p>
        ) : (
          <>
            <p className="mb-2.5 text-xs text-zinc-500">
              Showing {shown.length} of {filtered.length}
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {shown.map((e) => (
                <CatalogCard key={e.id} entry={e} requested={requestedIds.has(e.id)} onOpen={() => setSelected(e)} />
              ))}
            </div>
            {visible < filtered.length && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  Show more ({filtered.length - visible} left)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <DetailModal
          entry={selected}
          requested={requestedIds.has(selected.id)}
          install={install}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/* ---------- tier badge ---------- */

function TierBadge({ tier }: { tier: TrustTier }) {
  const m = TIER_META[tier];
  return (
    <span title={m.help} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.chip}`}>
      {m.icon} {m.label}
    </span>
  );
}

/* ---------- list card ---------- */

function CatalogCard({ entry, requested, onOpen }: { entry: CatalogEntry; requested: boolean; onOpen: () => void }) {
  const meta = TYPE_META[entry.type];
  const tier = tierOf(entry);
  const flags = entry.safetyFlags ?? [];
  return (
    <button
      onClick={onOpen}
      className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {entry.recommended && (
            <span title="Best pick in its category" className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              <Star className="h-3 w-3 fill-emerald-300" /> Recommended
            </span>
          )}
          <h3 className="text-sm font-semibold text-zinc-100">{entry.name}</h3>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.chip}`}>
          {meta.icon} {meta.label}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs text-zinc-400">{entry.description}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TierBadge tier={tier} />
        {(entry.categories ?? []).slice(0, 1).map((c) => (
          <span key={c} className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400">
            {c}
          </span>
        ))}
        {entry.stale && (
          <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-300">
            <AlertTriangle className="h-3 w-3" /> Unmaintained
          </span>
        )}
        {requested && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Install in progress
          </span>
        )}
      </div>

      {flags.length > 0 && (
        <p className="mt-2 flex items-start gap-1 text-[11px] text-red-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-1">{flags[0]}</span>
        </p>
      )}
    </button>
  );
}

/* ---------- detail + install modal ---------- */

function DetailModal({
  entry,
  requested,
  install,
  onClose,
}: {
  entry: CatalogEntry;
  requested: boolean;
  install: InstallContext;
  onClose: () => void;
}) {
  const meta = TYPE_META[entry.type];
  const tier = tierOf(entry);
  const flags = entry.safetyFlags ?? [];
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetLabel = install.mode === "agent" ? install.agentLabel : "all agents";

  async function doInstall() {
    setError(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        url: entry.url,
        target_agent: install.mode === "agent" ? install.agentId : "all",
        notes: notes.trim() ? notes.trim() : `From the tool catalog: ${entry.name} (${meta.label}).`,
      };
      if (install.mode === "agent") payload.project = install.project;
      const res = await fetch("/api/tools/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) setDone(true);
      else setError(data.error ?? "Couldn't start the install.");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const gated = install.mode === "agent" && !install.available;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-900 p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {entry.recommended && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <Star className="h-3 w-3 fill-emerald-300" /> Recommended
                </span>
              )}
              <h2 className="text-base font-semibold text-zinc-100">{entry.name}</h2>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.chip}`}>
                {meta.icon} {meta.label}
              </span>
              <TierBadge tier={tier} />
            </div>
            <p className="mt-1.5 text-sm text-zinc-300">{entry.description}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* safety warnings (red) */}
        {flags.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-300">
              <AlertTriangle className="h-4 w-4" /> Heads up before you install
            </p>
            <ul className="space-y-1">
              {flags.map((f, i) => (
                <li key={i} className="flex gap-2 text-xs text-red-200">
                  <span>•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* unmaintained note */}
        {entry.stale && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-xs text-orange-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
            <span>{entry.staleReason ?? "This tool hasn't been updated in a while — it may be unmaintained."}</span>
          </div>
        )}

        {/* unreviewed note */}
        {tier === "unreviewed" && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>Found automatically by a scan — the details below aren&apos;t verified yet. Open the link to check it before installing.</span>
          </div>
        )}

        {/* what it's good for */}
        {entry.goodFor.length > 0 && (
          <Section title="What it's good for">
            <ul className="space-y-1">
              {entry.goodFor.map((g, i) => (
                <li key={i} className="flex gap-2 text-sm text-zinc-300">
                  <span className="text-emerald-400">•</span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* key features */}
        {entry.features.length > 0 && (
          <Section title="Key features">
            <div className="flex flex-wrap gap-1.5">
              {entry.features.map((f, i) => (
                <span key={i} className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-0.5 text-xs text-zinc-300">
                  {f}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* requirements + popularity */}
        <Section title="Setup needed">
          <p className="text-sm text-zinc-300">{entry.requirements}</p>
        </Section>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span>{entry.popularity}</span>
          <a href={entry.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-400 hover:underline">
            View source <ExternalLink className="h-3 w-3" />
          </a>
          {entry.lastVerified && <span>Verified {entry.lastVerified}</span>}
        </div>

        {/* install */}
        <div className="mt-5 border-t border-zinc-800 pt-4">
          {done ? (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div className="text-sm text-zinc-200">
                <p className="font-semibold text-emerald-300">Install started.</p>
                <p className="mt-1 text-zinc-400">
                  Claude is wiring <strong className="text-zinc-200">{entry.name}</strong> into {targetLabel}. It arrives as a
                  build to approve, and if it needs a key or account you&apos;ll see a task in the{" "}
                  <strong className="text-zinc-200">Needs you</strong> box.
                </p>
              </div>
            </div>
          ) : gated ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This project doesn&apos;t have the tool-installer set up yet, so tools can&apos;t be installed
                here. Onboard it from the Projects menu first.
              </span>
            </div>
          ) : (
            <>
              <p className="mb-2 text-sm text-zinc-300">
                {install.mode === "agent" ? (
                  <>
                    Install into <strong className="text-zinc-100">{install.agentLabel}</strong>.
                  </>
                ) : (
                  <>Install for <strong className="text-zinc-100">all agents</strong>.</>
                )}
              </p>

              <label className="mt-1 block">
                <span className="mb-1 block text-xs font-medium text-zinc-400">Anything Claude should know? (optional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="What you want it used for, gotchas, etc."
                  className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
                />
              </label>

              {requested && <p className="mt-2 text-xs text-amber-300">Heads up: an install for this one already looks to be in progress.</p>}
              {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}

              <button
                onClick={doInstall}
                disabled={busy}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Wrench className="h-4 w-4" />
                {busy ? "Sending…" : install.mode === "agent" ? `Install for ${install.agentLabel}` : `Install for all agents`}
              </button>

              {install.mode === "all" && <p className="mt-2 text-[11px] text-zinc-500">{MAP_HINT}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </div>
  );
}
