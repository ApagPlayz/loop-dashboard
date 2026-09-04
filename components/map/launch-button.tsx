"use client";

/**
 * Launch chip for the map toolbar. Three lives:
 *   1. No launcher yet → "Create launcher": Claude analyzes the project's
 *      local folder in a background job and writes a self-closing .command.
 *   2. Launcher exists, product not running → "Launch": opens the launcher
 *      (a Terminal window that starts the product and closes itself), then
 *      polls until the product answers and opens it in a new tab.
 *   3. Product running → "Open" with a green dot, plus a small re-analyze
 *      action to redo the AI analysis.
 *
 * Self-contained: drop <LaunchButton projectKey={...} /> into the toolbar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, RotateCw, Rocket, Wand2 } from "lucide-react";

type Status = {
  configured: boolean;
  running: boolean;
  url: string | null;
  kind: string | null;
  analyzedAt: string | null;
  notes: string | null;
};

type Phase =
  | "checking" // initial status fetch
  | "idle" // status known, nothing in flight
  | "analyzing" // AI analysis job running
  | "launching"; // launcher opened, waiting for the product to answer

const ANALYZE_POLL_MS = 2500;
const LAUNCH_POLL_MS = 2000;
const LAUNCH_TIMEOUT_MS = 90_000;

const chipBase =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors";
const chipNeutral = `${chipBase} border-zinc-800 text-zinc-400 hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300`;
const chipEmerald = `${chipBase} border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`;
const chipBusy = `${chipBase} border-zinc-800 bg-zinc-900/60 text-zinc-400 cursor-default`;

export default function LaunchButton({ projectKey }: { projectKey: string }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Timers/generation guard so a project switch cancels in-flight polling.
  const generation = useRef(0);

  // Project switch: reset during render (avoids setState-in-effect churn).
  const [lastKey, setLastKey] = useState(projectKey);
  if (lastKey !== projectKey) {
    setLastKey(projectKey);
    setPhase("checking");
    setStatus(null);
    setError(null);
  }

  const fetchStatus = useCallback(async (): Promise<Status | null> => {
    try {
      const res = await fetch(`/api/launch/status?project=${encodeURIComponent(projectKey)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't check the launcher.");
      return j as Status;
    } catch {
      return null;
    }
  }, [projectKey]);

  /** Poll a running analysis job until it settles, then refresh the status. */
  const watchAnalysis = useCallback(
    async (jobId: string, gen: number) => {
      try {
        while (generation.current === gen) {
          await new Promise((r) => setTimeout(r, ANALYZE_POLL_MS));
          if (generation.current !== gen) return;
          const poll = await fetch(`/api/launch/analyze/${jobId}`);
          if (poll.status === 404) throw new Error("That analysis expired. Try again.");
          const pj = await poll.json().catch(() => ({}));
          const job = pj.job as { status: string; error?: string } | undefined;
          if (!job) continue;
          if (job.status === "error") throw new Error(job.error ?? "The analysis failed. Try again.");
          if (job.status === "done") break;
        }
        if (generation.current !== gen) return;

        const s = await fetchStatus();
        if (generation.current !== gen) return;
        if (s) setStatus(s);
        setPhase("idle");
      } catch (e) {
        if (generation.current !== gen) return;
        setError(e instanceof Error ? e.message : "The analysis failed. Try again.");
        setPhase("idle");
      }
    },
    [fetchStatus],
  );

  // On mount / project switch: find out where this project stands, and
  // re-attach to an analysis that's still running from a previous visit.
  useEffect(() => {
    // Copy the ref object so the cleanup invalidates the right generation.
    const gens = generation;
    const gen = ++gens.current;
    (async () => {
      const s = await fetchStatus();
      if (gens.current !== gen) return;
      setStatus(s ?? { configured: false, running: false, url: null, kind: null, analyzedAt: null, notes: null });

      // A still-running analysis job survives navigation — pick it back up.
      try {
        const res = await fetch(`/api/launch/analyze?project=${encodeURIComponent(projectKey)}`);
        const j = await res.json().catch(() => ({}));
        if (gens.current !== gen) return;
        const job = j.job as { id: string; status: string } | null;
        if (job && job.status === "running") {
          setPhase("analyzing");
          void watchAnalysis(job.id, gen);
          return;
        }
      } catch {
        // No restore — not fatal.
      }
      if (gens.current !== gen) return;
      setPhase("idle");
    })();
    return () => {
      gens.current++;
    };
  }, [projectKey, fetchStatus, watchAnalysis]);

  /* ---------------- Create / re-analyze ---------------- */

  const analyze = useCallback(async () => {
    const gen = generation.current;
    setPhase("analyzing");
    setError(null);
    try {
      const res = await fetch("/api/launch/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectKey }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't start the analysis.");
      await watchAnalysis(j.jobId as string, gen);
    } catch (e) {
      if (generation.current !== gen) return;
      setError(e instanceof Error ? e.message : "The analysis failed. Try again.");
      setPhase("idle");
    }
  }, [projectKey, watchAnalysis]);

  /* ---------------- Launch ---------------- */

  const launch = useCallback(async () => {
    const gen = generation.current;
    setPhase("launching");
    setError(null);
    try {
      const res = await fetch("/api/launch/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectKey }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't launch the product.");

      if (j.alreadyRunning && j.url) {
        window.open(j.url as string, "_blank", "noopener");
        setStatus((s) => (s ? { ...s, running: true } : s));
        setPhase("idle");
        return;
      }

      // Poll until the product answers (a Terminal window is doing the work).
      const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
      while (Date.now() < deadline && generation.current === gen) {
        await new Promise((r) => setTimeout(r, LAUNCH_POLL_MS));
        if (generation.current !== gen) return;
        const s = await fetchStatus();
        if (generation.current !== gen) return;
        if (s?.running) {
          setStatus(s);
          setPhase("idle");
          if (s.url) window.open(s.url, "_blank", "noopener");
          return;
        }
      }
      if (generation.current !== gen) return;
      // No url to check (e.g. a desktop app) — assume the launcher did its job.
      const s = await fetchStatus();
      if (generation.current !== gen) return;
      if (s && !s.url) {
        setStatus(s);
        setPhase("idle");
        return;
      }
      throw new Error(
        "It hasn't come up yet — a Terminal window opened to start it; check there for details.",
      );
    } catch (e) {
      if (generation.current !== gen) return;
      setError(e instanceof Error ? e.message : "Couldn't launch the product. Try again.");
      setPhase("idle");
    }
  }, [projectKey, fetchStatus]);

  /* ---------------- Render ---------------- */

  if (phase === "checking") {
    return (
      <span className={chipBusy} title="Checking this project's launcher...">
        <Loader2 className="h-3 w-3 animate-spin" />
        Launch
      </span>
    );
  }

  if (phase === "analyzing") {
    return (
      <span className={chipBusy} title="Keeps running if you leave this page — come back any time.">
        <Loader2 className="h-3 w-3 animate-spin" />
        Claude is figuring out how to launch this...
      </span>
    );
  }

  if (phase === "launching") {
    return (
      <span className={chipBusy}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Launching...
      </span>
    );
  }

  const errorBits = error ? (
    <span className="inline-flex max-w-[260px] items-center gap-1.5 text-[11px] text-red-400">
      <span className="truncate" title={error}>
        {error}
      </span>
    </span>
  ) : null;

  if (!status?.configured) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={analyze}
          className={chipNeutral}
          title="Have Claude work out how to launch this project and create a one-click launcher"
        >
          <Wand2 className="h-3 w-3" />
          {error ? "Retry" : "Create launcher"}
        </button>
        {errorBits}
      </span>
    );
  }

  if (status.running) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => status.url && window.open(status.url, "_blank", "noopener")}
          className={chipEmerald}
          title={status.url ? `Open ${status.url}` : "The product is running"}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Open
          <ExternalLink className="h-3 w-3" />
        </button>
        <ReanalyzeButton onClick={analyze} />
        {errorBits}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={launch}
        className={chipEmerald}
        title={status.notes ?? "Launch this product"}
      >
        <Rocket className="h-3 w-3" />
        {error ? "Retry launch" : "Launch"}
      </button>
      <ReanalyzeButton onClick={analyze} />
      {errorBits}
    </span>
  );
}

/**
 * "Redo launch setup" — the one control on this toolbar that starts a Claude
 * run (POST /api/launch/analyze runs the local Claude CLI and rewrites this
 * project's launcher config).
 *
 * It used to be an unlabelled circular icon button: invisible to screen
 * readers, and to everyone else a mystery you could only solve by pressing it.
 * Now it says what it does before it is pressed — a visible label, a real
 * accessible name, and a tooltip spelling out the consequence.
 */
function ReanalyzeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={chipNeutral}
      aria-label="Redo launch setup — runs Claude to work out how to launch this project again"
      title="Runs Claude on your Mac to work out how to launch this project again, and rewrites its launcher. Takes a minute or two; the current launcher keeps working until it finishes."
    >
      <RotateCw className="h-3 w-3" />
      Redo launch setup
    </button>
  );
}
