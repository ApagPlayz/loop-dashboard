"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, ExternalLink, CheckCircle2, XCircle, MinusCircle, Loader2 } from "lucide-react";
import StatusBadge from "./status-badge";
import { relativeTime, duration, statusMeta } from "./format";

type RunSummary = {
  id: number;
  status: string | null;
  conclusion: string | null;
  createdAt: string;
  runStartedAt: string | null;
  updatedAt: string;
  htmlUrl: string;
};
type Step = { name: string; status: string | null; conclusion: string | null; number: number };

type Data =
  | { notLive: true }
  | { latest: RunSummary; history: RunSummary[]; steps: Step[] };

// The steps we care about, matched loosely by name.
const KEY_STEPS: { label: string; match: RegExp }[] = [
  { label: "Install", match: /install|npm ci|dependencies/i },
  { label: "Lint", match: /lint/i },
  { label: "Tests", match: /test|vitest/i },
  { label: "Build", match: /build/i },
];

function StepIcon({ tone }: { tone: string }) {
  const cls = "h-4 w-4";
  if (tone === "success") return <CheckCircle2 className={`${cls} text-emerald-400`} />;
  if (tone === "failure") return <XCircle className={`${cls} text-red-400`} />;
  if (tone === "running") return <Loader2 className={`${cls} animate-spin text-emerald-400`} />;
  return <MinusCircle className={`${cls} text-zinc-500`} />;
}

export default function TestSuite() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/testing/test-suite", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error();
      setData(d);
      setError(null);
    } catch {
      setError("Couldn't load test results.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (data && "latest" in data && data.latest.status !== "completed") {
      const t = setInterval(load, 5000);
      return () => clearInterval(t);
    }
  }, [data, load]);

  const rerun = useCallback(async () => {
    setRerunning(true);
    setFlash(null);
    try {
      const res = await fetch("/api/testing/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "repo-tests.yml" }),
      });
      const d = await res.json();
      setFlash(res.ok ? "Re-running now…" : d.error ?? "Couldn't start.");
      if (res.ok) {
        setTimeout(load, 3000);
        setTimeout(load, 7000);
      }
    } catch {
      setFlash("Network error — try again.");
    } finally {
      setRerunning(false);
    }
  }, [load]);

  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;

  if ("notLive" in data) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-200">
        The test suite isn&apos;t live yet — it arrives when PR #44 merges on the
        target repo. You&apos;ll see pass/fail results here once it&apos;s run at
        least once.
      </div>
    );
  }

  const { latest, history, steps } = data;
  const overall = statusMeta(latest.status, latest.conclusion);

  return (
    <div className="space-y-6">
      {/* Overall */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <StatusBadge status={latest.status} conclusion={latest.conclusion} />
            <span className="text-sm text-zinc-400">
              Latest run · {relativeTime(latest.createdAt)} ·{" "}
              {duration(
                latest.runStartedAt ?? latest.createdAt,
                latest.status === "completed" ? latest.updatedAt : null,
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={latest.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
            >
              GitHub <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={rerun}
              disabled={rerunning}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {rerunning ? "Starting…" : "Re-run"}
            </button>
          </div>
        </div>
        {flash && <p className="mt-2 text-xs text-emerald-400">{flash}</p>}

        {/* Per-step rows */}
        <div className="mt-4 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {KEY_STEPS.map((ks) => {
            const step = steps.find((s) => ks.match.test(s.name));
            const tone = step
              ? statusMeta(step.status, step.conclusion).tone
              : "neutral";
            return (
              <div
                key={ks.label}
                className="flex items-center justify-between px-3 py-2.5"
              >
                <span className="flex items-center gap-2 text-sm text-zinc-200">
                  <StepIcon tone={tone} />
                  {ks.label}
                </span>
                <span className="text-xs text-zinc-500">
                  {step ? statusMeta(step.status, step.conclusion).label : "—"}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-zinc-600">
          Overall: {overall.label}. Steps matched by name from the run&apos;s job.
        </p>
      </div>

      {/* History dots */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-300">
          Last {history.length} runs
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {history.map((r) => {
            const tone = statusMeta(r.status, r.conclusion).tone;
            const color =
              tone === "success"
                ? "bg-emerald-500"
                : tone === "failure"
                  ? "bg-red-500"
                  : tone === "running"
                    ? "bg-emerald-500/50 animate-pulse"
                    : "bg-zinc-600";
            return (
              <a
                key={r.id}
                href={r.htmlUrl}
                target="_blank"
                rel="noreferrer"
                title={`${statusMeta(r.status, r.conclusion).label} · ${relativeTime(r.createdAt)}`}
                className={`h-4 w-4 rounded-full ${color} ring-1 ring-inset ring-black/30`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
