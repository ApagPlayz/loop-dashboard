"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Telescope,
  Search,
  RefreshCw,
  Server,
  Sparkles,
  Puzzle,
  Loader2,
  AlertTriangle,
  Check,
  ChevronDown,
} from "lucide-react";
import { useProject } from "@/components/project-context";

/* ---------- types (mirror lib/tool-fit.ts wire shapes) ---------- */

type ToolType = "mcp" | "skill" | "plugin";
type TrustTier = "official" | "verified" | "community" | "unreviewed";

type ToolScore = {
  id: string;
  name: string;
  type: ToolType;
  url: string;
  trustTier?: TrustTier;
  categories?: string[];
  safetyFlags?: string[];
  score: number;
  reason: string;
  estimated: boolean;
  /** Agents that already carry this tool (mirror of lib/tool-fit.ts). */
  alreadyHave?: string[];
  /** Agents this tool is worth adding to (mirror of lib/tool-fit.ts). */
  recommendForAgents?: string[];
};

type ScanResult = {
  owner: string;
  repo: string;
  scored: ToolScore[];
  totalTools: number;
  aiScoredCount: number;
  aiUsed: boolean;
  scannedAt: string;
};

type Progress = { phase: "profiling" | "ranking" | "scoring" | "done"; done: number; total: number };

type FitJob = {
  id: string;
  owner: string;
  repo: string;
  status: "running" | "done" | "error";
  progress: Progress;
  result?: ScanResult;
  error?: string;
};

type ProjectRepo = { owner: string; repo: string; label: string; fullName: string };

/* ---------- shared bits ---------- */

const MAP_HINT = "Installs go to all agents. Want it on just one? Open that agent on the Process Map → Install tools tab.";

const TYPE_META: Record<ToolType, { label: string; chip: string; icon: React.ReactNode }> = {
  mcp: { label: "MCP server", chip: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: <Server className="h-3 w-3" /> },
  skill: { label: "Skill", chip: "border-violet-500/30 bg-violet-500/10 text-violet-300", icon: <Sparkles className="h-3 w-3" /> },
  plugin: { label: "Plugin", chip: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: <Puzzle className="h-3 w-3" /> },
};

const VIEW_OPTIONS = [
  { value: 20, label: "Top 20" },
  { value: 50, label: "Top 50" },
  { value: 100, label: "Top 100" },
  { value: 0, label: "All" },
];

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
  if (score >= 60) return "text-lime-300 border-lime-500/40 bg-lime-500/10";
  if (score >= 40) return "text-amber-300 border-amber-500/40 bg-amber-500/10";
  return "text-zinc-400 border-zinc-700 bg-zinc-800/60";
}

function phaseLabel(p: Progress): string {
  if (p.phase === "profiling") return "Reading the repository…";
  if (p.phase === "ranking") return "Shortlisting the most likely tools…";
  if (p.phase === "scoring") return `Scoring tools with AI… ${p.done}/${p.total}`;
  return "Finishing up…";
}

/* ---------- per-row install control ---------- */

function InstallRow({ tool }: { tool: ToolScore }) {
  // The scan can be pointed at ANY repo, but the install always goes to the
  // project currently selected in the switcher — stated explicitly, never
  // defaulted server-side.
  const { project } = useProject();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const install = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      // Tools-tab installs always go to all agents (see the hint above the list).
      const res = await fetch("/api/tools/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, url: tool.url, target_agent: "all" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't start the install.");
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start the install.");
    } finally {
      setBusy(false);
    }
  }, [tool.url, project]);

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
        <Check className="h-3.5 w-3.5" /> Install started
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={install}
        disabled={busy}
        title="Install for all agents"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-zinc-800 disabled:opacity-50"
      >
        {busy ? "…" : "Install"}
      </button>
      {err && <span className="text-[10px] text-amber-300">{err}</span>}
    </div>
  );
}

/* ---------- main ---------- */

export default function FitScan() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectRepo[]>([]);
  const [freeText, setFreeText] = useState("");
  const [selected, setSelected] = useState<{ owner: string; repo: string } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<number>(20);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The job currently shown, so closing/replacing it can mark it consumed.
  const jobIdRef = useRef<string | null>(null);

  // Load the project dropdown once the panel is opened.
  useEffect(() => {
    if (!open || projects.length) return;
    fetch("/api/tools/fit/repos", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, [open, projects.length]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  /** Tell the server the owner is done with this scan (best-effort). */
  const consumeJob = useCallback(() => {
    const id = jobIdRef.current;
    jobIdRef.current = null;
    if (id) fetch(`/api/tools/fit/${id}`, { method: "POST" }).catch(() => {});
  }, []);

  const pollJob = useCallback(
    (jobId: string) => {
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/tools/fit/${jobId}`, { cache: "no-store" });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error ?? "Scan lost.");
          const job = d.job as FitJob;
          setProgress(job.progress);
          if (job.status === "done" && job.result) {
            setResult(job.result);
            setScanning(false);
            setProgress(null);
            stopPoll();
          } else if (job.status === "error") {
            setError(job.error ?? "The scan failed. Try again.");
            setScanning(false);
            setProgress(null);
            stopPoll();
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Lost contact with the scan.");
          setScanning(false);
          stopPoll();
        }
      }, 2500);
    },
    [stopPoll],
  );

  const startScan = useCallback(
    async (owner: string, repo: string, rescan = false) => {
      // A new scan replaces whatever was showing — mark the old one done with.
      consumeJob();
      setSelected({ owner, repo });
      setError(null);
      setResult(null);
      setScanning(true);
      setProgress({ phase: "profiling", done: 0, total: 0 });
      try {
        const res = await fetch("/api/tools/fit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner, repo, rescan }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? "Couldn't start the scan.");
        if (d.cached && d.result) {
          setResult(d.result);
          setScanning(false);
          setProgress(null);
        } else if (d.jobId) {
          jobIdRef.current = d.jobId;
          pollJob(d.jobId);
        } else {
          throw new Error("Couldn't start the scan.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't start the scan.");
        setScanning(false);
        setProgress(null);
      }
    },
    [pollJob, consumeJob],
  );

  // On mount: re-attach to a scan the owner walked away from (running, or
  // finished while he was on another page and not yet closed).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tools/fit", { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        const job = d.job as FitJob | null;
        if (cancelled || !job) return;
        jobIdRef.current = job.id;
        setOpen(true);
        setSelected({ owner: job.owner, repo: job.repo });
        setFreeText(`${job.owner}/${job.repo}`);
        if (job.status === "running") {
          setScanning(true);
          setProgress(job.progress);
          pollJob(job.id);
        } else if (job.status === "done" && job.result) {
          setResult(job.result);
        } else if (job.status === "error") {
          setError(job.error ?? "The scan failed. Try again.");
        }
      } catch {
        // Nothing to restore — not fatal.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScanClicked = useCallback(() => {
    // Prefer a selected project's exact owner/repo; otherwise parse the free text.
    const text = freeText.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
    const m = text.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
    if (m) {
      startScan(m[1], m[2]);
      return;
    }
    setError("Enter a repository as owner/name (for example ApagPlayz/loop-dashboard).");
  }, [freeText, startScan]);

  const shown = result
    ? view === 0
      ? result.scored
      : result.scored.slice(0, view)
    : [];

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition hover:border-emerald-500/40 hover:bg-zinc-800/60"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
          <Telescope className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-zinc-100">Find tools for a project</span>
          <span className="block text-xs text-zinc-400">
            Pick a repo and let Claude rate every tool 0–100 on how well it fits.
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Telescope className="h-4 w-4 text-emerald-400" />
          Find tools for a project
        </h3>
        <button
          onClick={() => {
            // Closing after a finished scan means "done with this result".
            // A still-running scan stays restorable when the panel reopens.
            if (!scanning) consumeJob();
            setOpen(false);
          }}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Close
        </button>
      </div>

      {/* Repo picker */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {projects.length > 0 && (
          <select
            value={selected ? `${selected.owner}/${selected.repo}` : ""}
            onChange={(e) => {
              const p = projects.find((x) => x.fullName === e.target.value);
              if (p) {
                setFreeText(p.fullName);
                startScan(p.owner, p.repo);
              }
            }}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">Choose a project…</option>
            {projects.map((p) => (
              <option key={p.fullName} value={p.fullName}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-1 items-center gap-2">
          <input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onScanClicked()}
            placeholder="…or any repo: owner/name"
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={onScanClicked}
            disabled={scanning}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            Scan
          </button>
        </div>
      </div>

      {/* Scanning progress */}
      {scanning && progress && (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="flex items-center gap-2 text-sm text-zinc-200">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            {phaseLabel(progress)}
          </p>
          {progress.phase === "scoring" && progress.total > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          )}
          <p className="mt-2 text-[11px] text-zinc-500">
            This can take a few minutes. You can leave this page and come back — the scan keeps running.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {result && !scanning && (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-zinc-400">
              <span className="font-medium text-zinc-200">
                {result.owner}/{result.repo}
              </span>{" "}
              — {result.aiUsed ? `${result.aiScoredCount} tools AI-scored` : "keyword estimate only"} of{" "}
              {result.totalTools}.
              {!result.aiUsed && (
                <span className="ml-1 text-amber-300">AI scoring was unavailable, so these are quick estimates.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={view}
                  onChange={(e) => setView(Number(e.target.value))}
                  className="appearance-none rounded-md border border-zinc-700 bg-zinc-950 py-1.5 pl-3 pr-8 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
                >
                  {VIEW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              </div>
              <button
                onClick={() => selected && startScan(selected.owner, selected.repo, true)}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                title="Run a fresh scan"
              >
                <RefreshCw className="h-3 w-3" /> Re-scan
              </button>
            </div>
          </div>

          <p className="mb-2 text-[11px] text-zinc-500">{MAP_HINT}</p>

          <div className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800">
            {shown.map((t, i) => {
              const meta = TYPE_META[t.type];
              return (
                <div key={t.id} className="flex items-start gap-3 bg-zinc-900/40 px-3 py-2.5">
                  <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-zinc-600">
                    {i + 1}
                  </span>
                  <span
                    className={`mt-0.5 flex h-9 w-11 shrink-0 flex-col items-center justify-center rounded-md border text-sm font-bold tabular-nums ${scoreColor(
                      t.score,
                    )}`}
                    title={t.estimated ? "Quick keyword estimate" : "AI-scored fit"}
                  >
                    {t.score}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-zinc-100">{t.name}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.chip}`}
                      >
                        {meta.icon}
                        {meta.label}
                      </span>
                      {t.estimated && (
                        <span className="rounded-full border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          quick estimate
                        </span>
                      )}
                      {(t.safetyFlags ?? []).length > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300">
                          <AlertTriangle className="h-2.5 w-2.5" /> heads-up
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-400">{t.reason}</p>
                    {((t.recommendForAgents ?? []).length > 0 || (t.alreadyHave ?? []).length > 0) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {(t.recommendForAgents ?? []).length > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
                            For: {t.recommendForAgents!.join(", ")}
                          </span>
                        )}
                        {(t.alreadyHave ?? []).length > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                            Already on: {t.alreadyHave!.join(", ")}
                          </span>
                        )}
                        {(t.recommendForAgents ?? []).length === 0 && (t.alreadyHave ?? []).length > 0 && (
                          <span className="text-zinc-500">nothing to add</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <InstallRow tool={t} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
