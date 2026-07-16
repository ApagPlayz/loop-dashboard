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
  Store,
  AlertTriangle,
} from "lucide-react";

/* ---------- types (mirror lib/tool-catalog.ts) ---------- */

type ToolType = "mcp" | "skill" | "plugin";
type ToolStatus = "reviewed" | "unreviewed";

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
};

/* ---------- target agents (same list as the install form) ---------- */

const AGENTS: { value: string; label: string; blurb: string }[] = [
  { value: "all", label: "All agents", blurb: "Every agent gets it" },
  { value: "scout", label: "Scout", blurb: "Finds work, files proposals" },
  { value: "builder", label: "Builder", blurb: "Writes code, opens PRs" },
  { value: "audit", label: "Auditor", blurb: "Reviews every PR" },
  { value: "retro", label: "Retro", blurb: "Reviews how the loop is doing" },
  { value: "mention", label: "Mention", blurb: "Replies when you write @claude" },
  { value: "demo", label: "Demo", blurb: "Captures screenshots / video" },
];

/* ---------- type styling ---------- */

const TYPE_META: Record<
  ToolType,
  { label: string; chip: string; icon: React.ReactNode }
> = {
  mcp: {
    label: "MCP server",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-300",
    icon: <Server className="h-3.5 w-3.5" />,
  },
  skill: {
    label: "Skill",
    chip: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    icon: <Sparkles className="h-3.5 w-3.5" />,
  },
  plugin: {
    label: "Plugin",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    icon: <Puzzle className="h-3.5 w-3.5" />,
  },
};

const FILTERS: { value: "all" | ToolType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mcp", label: "MCP servers" },
  { value: "skill", label: "Skills" },
  { value: "plugin", label: "Plugins" },
];

/* ================================================================== */

export default function ToolCatalog() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | ToolType>("all");
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter !== "all" && e.type !== filter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.goodFor.some((g) => g.toLowerCase().includes(q)) ||
        e.features.some((f) => f.toLowerCase().includes(q))
      );
    });
  }, [entries, query, filter]);

  const counts = useMemo(() => {
    const c = { mcp: 0, skill: 0, plugin: 0 };
    for (const e of entries) c[e.type]++;
    return c;
  }, [entries]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-1 flex items-center gap-2">
        <Store className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-zinc-100">Browse the tool catalog</h2>
      </div>
      <p className="mb-4 text-xs text-zinc-400">
        Popular MCP servers, skills, and plugins. Tap one to see what it does, then
        install it into any agent. {entries.length > 0 && (
          <span className="text-zinc-500">
            {" "}
            {counts.mcp} MCP · {counts.skill} skills · {counts.plugin} plugins.
          </span>
        )}
      </p>

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

      {/* List */}
      <div className="mt-4">
        {!loaded ? (
          <p className="text-sm text-zinc-500">Loading catalog…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-zinc-500">No tools match your search.</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {filtered.map((e) => (
              <CatalogCard
                key={e.id}
                entry={e}
                requested={requestedIds.has(e.id)}
                onOpen={() => setSelected(e)}
              />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <DetailModal
          entry={selected}
          requested={requestedIds.has(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/* ---------- list card ---------- */

function CatalogCard({
  entry,
  requested,
  onOpen,
}: {
  entry: CatalogEntry;
  requested: boolean;
  onOpen: () => void;
}) {
  const meta = TYPE_META[entry.type];
  return (
    <button
      onClick={onOpen}
      className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/40"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">{entry.name}</h3>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.chip}`}
        >
          {meta.icon} {meta.label}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs text-zinc-400">{entry.description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {entry.status === "unreviewed" && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            <AlertTriangle className="h-3 w-3" /> New · unreviewed
          </span>
        )}
        {requested && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Install in progress
          </span>
        )}
      </div>
    </button>
  );
}

/* ---------- detail + install modal ---------- */

function DetailModal({
  entry,
  requested,
  onClose,
}: {
  entry: CatalogEntry;
  requested: boolean;
  onClose: () => void;
}) {
  const meta = TYPE_META[entry.type];
  const [target, setTarget] = useState("all");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function install() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/tools/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: entry.url,
          target_agent: target,
          notes: notes.trim()
            ? notes.trim()
            : `From the tool catalog: ${entry.name} (${meta.label}).`,
        }),
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-900 p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-100">{entry.name}</h2>
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.chip}`}
              >
                {meta.icon} {meta.label}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-zinc-300">{entry.description}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {entry.status === "unreviewed" && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Found automatically by a scan — the details below aren&apos;t verified
              yet. Open the link to check it before installing.
            </span>
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
                <span
                  key={i}
                  className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-0.5 text-xs text-zinc-300"
                >
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
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
          >
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
                  Claude is wiring{" "}
                  <strong className="text-zinc-200">{entry.name}</strong> into{" "}
                  {AGENTS.find((a) => a.value === target)?.label ?? target}. It arrives
                  as a build to approve, and if it needs a key or account you&apos;ll see
                  a task in the <strong className="text-zinc-200">Needs you</strong> box.
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium text-zinc-400">
                Install this into which agent?
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {AGENTS.map((a) => {
                  const active = target === a.value;
                  return (
                    <button
                      key={a.value}
                      type="button"
                      onClick={() => setTarget(a.value)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        active
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-zinc-700 bg-zinc-950 hover:bg-zinc-800"
                      }`}
                    >
                      <span className="block text-xs font-semibold text-zinc-100">
                        {a.label}
                      </span>
                      <span className="block text-[11px] text-zinc-500">{a.blurb}</span>
                    </button>
                  );
                })}
              </div>

              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-medium text-zinc-400">
                  Anything Claude should know? (optional)
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="What you want it used for, gotchas, etc."
                  className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
                />
              </label>

              {requested && (
                <p className="mt-2 text-xs text-amber-300">
                  Heads up: an install for this one already looks to be in progress.
                </p>
              )}
              {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}

              <button
                onClick={install}
                disabled={busy}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Wrench className="h-4 w-4" />
                {busy ? "Sending…" : `Install ${entry.name}`}
              </button>
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
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      {children}
    </div>
  );
}
