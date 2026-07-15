"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, ExternalLink, RefreshCw } from "lucide-react";
import StatusBadge from "./status-badge";
import RunDetail from "./run-detail";
import { relativeTime, duration } from "./format";

type RunSummary = {
  id: number;
  displayName: string;
  workflowFile: string | null;
  status: string | null;
  conclusion: string | null;
  createdAt: string;
  runStartedAt: string | null;
  updatedAt: string;
  htmlUrl: string;
  event: string;
};

type Option = { value: string; label: string };

type WorkflowCard = {
  file: string;
  name: string;
  description: string;
  input?: { name: string; source: "redraft-issues" | "claude-prs"; label: string };
  pendingPr44?: boolean;
};

// Kept in sync with the runnable entries in lib/testing.ts WORKFLOWS.
const CARDS: WorkflowCard[] = [
  {
    file: "claude-scout.yml",
    name: "Scout",
    description:
      "Looks for new work worth doing and files proposals for you to approve. Safe anytime — never changes code.",
  },
  {
    file: "claude-builder.yml",
    name: "Builder",
    description:
      "Picks the best approved proposal and opens one pull request with the change.",
  },
  {
    file: "claude-redraft.yml",
    name: "Redraft a proposal",
    description: "Rewrites a proposal so it's clearer or better scoped.",
    input: { name: "issue_number", source: "redraft-issues", label: "Which proposal" },
    pendingPr44: true,
  },
  {
    file: "claude-demo.yml",
    name: "Capture demo evidence",
    description:
      "Runs the app for a pull request and captures screenshots / video so you can see it working.",
    input: { name: "pr_number", source: "claude-prs", label: "Which pull request" },
    pendingPr44: true,
  },
  {
    file: "claude-retro.yml",
    name: "Retro",
    description: "Reviews how the loop has been doing and writes up lessons learned.",
  },
  {
    file: "loop-metrics.yml",
    name: "Refresh metrics",
    description: "Recounts the loop's numbers and saves a fresh daily snapshot.",
  },
  {
    file: "repo-tests.yml",
    name: "Test suite",
    description: "Runs install, lint, tests, and build to confirm nothing is broken.",
    pendingPr44: true,
  },
];

export default function RunAgents() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [options, setOptions] = useState<{
    redraftIssues: Option[];
    claudePrs: Option[];
  }>({ redraftIssues: [], claudePrs: [] });
  const [selected, setSelected] = useState<{ id: number; htmlUrl: string } | null>(
    null,
  );
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, { ok: boolean; msg: string }>>(
    {},
  );

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/testing/runs?per_page=15", {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setRuns(data.runs ?? []);
    } catch {
      /* ignore transient */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRuns();
    fetch("/api/testing/dispatch-options", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) =>
        setOptions({
          redraftIssues: d.redraftIssues ?? [],
          claudePrs: d.claudePrs ?? [],
        }),
      )
      .catch(() => {});
  }, [loadRuns]);

  // Poll runs while anything is active, otherwise a slow refresh.
  useEffect(() => {
    const active = runs.some((r) => r.status !== "completed");
    const t = setInterval(loadRuns, active ? 5000 : 20000);
    return () => clearInterval(t);
  }, [runs, loadRuns]);

  const runNow = useCallback(
    async (card: WorkflowCard) => {
      setBusy(card.file);
      setFlash((p) => ({ ...p, [card.file]: undefined as never }));
      const payload: { file: string; inputs?: Record<string, string> } = {
        file: card.file,
      };
      if (card.input) {
        const val = inputs[card.file];
        if (!val) {
          setBusy(null);
          setFlash((p) => ({
            ...p,
            [card.file]: { ok: false, msg: "Pick an option first." },
          }));
          return;
        }
        payload.inputs = { [card.input.name]: val };
      }
      try {
        const res = await fetch("/api/testing/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok) {
          setFlash((p) => ({
            ...p,
            [card.file]: { ok: true, msg: "Started — watch for it below." },
          }));
          // Poll a few times so the fresh run shows up quickly.
          setTimeout(loadRuns, 2500);
          setTimeout(loadRuns, 6000);
        } else {
          setFlash((p) => ({
            ...p,
            [card.file]: {
              ok: false,
              msg: data.error ?? "Couldn't start the run.",
            },
          }));
        }
      } catch {
        setFlash((p) => ({
          ...p,
          [card.file]: { ok: false, msg: "Network error — try again." },
        }));
      } finally {
        setBusy(null);
      }
    },
    [inputs, loadRuns],
  );

  const latestFor = (file: string) =>
    runs.find((r) => r.workflowFile === file) ?? null;

  return (
    <div className="space-y-8">
      {/* Cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((card) => {
          const latest = latestFor(card.file);
          const f = flash[card.file];
          const opts =
            card.input?.source === "redraft-issues"
              ? options.redraftIssues
              : card.input?.source === "claude-prs"
                ? options.claudePrs
                : [];
          return (
            <div
              key={card.file}
              className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {card.name}
                </h3>
                {card.pendingPr44 && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    needs PR #44
                  </span>
                )}
              </div>
              <p className="mt-1 flex-1 text-xs text-zinc-400">
                {card.description}
              </p>

              {card.input && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-[11px] font-medium text-zinc-500">
                    {card.input.label}
                  </span>
                  <select
                    value={inputs[card.file] ?? ""}
                    onChange={(e) =>
                      setInputs((p) => ({ ...p, [card.file]: e.target.value }))
                    }
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">
                      {opts.length ? "Choose…" : "None available"}
                    </option>
                    {opts.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  onClick={() => runNow(card)}
                  disabled={busy === card.file}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  {busy === card.file ? "Starting…" : "Run"}
                </button>
                {latest && (
                  <button
                    onClick={() =>
                      setSelected({ id: latest.id, htmlUrl: latest.htmlUrl })
                    }
                    className="flex items-center gap-1.5"
                    title="View latest run"
                  >
                    <span className="text-[11px] text-zinc-500">
                      {relativeTime(latest.createdAt)}
                    </span>
                    <StatusBadge
                      status={latest.status}
                      conclusion={latest.conclusion}
                    />
                  </button>
                )}
              </div>

              {f && (
                <p
                  className={`mt-2 text-xs ${f.ok ? "text-emerald-400" : "text-amber-300"}`}
                >
                  {f.msg}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected run detail */}
      {selected && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100">
              Live run progress
            </h3>
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Close
            </button>
          </div>
          <RunDetail
            key={selected.id}
            runId={selected.id}
            htmlUrl={selected.htmlUrl}
          />
        </section>
      )}

      {/* Recent runs table */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">Recent runs</h3>
          <button
            onClick={loadRuns}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Workflow</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                    No runs yet.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-medium text-zinc-200">
                    <button
                      onClick={() =>
                        setSelected({ id: r.id, htmlUrl: r.htmlUrl })
                      }
                      className="hover:text-emerald-400"
                    >
                      {r.displayName}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} conclusion={r.conclusion} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-zinc-400">
                    {duration(r.runStartedAt ?? r.createdAt, r.status === "completed" ? r.updatedAt : null)}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {relativeTime(r.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{r.event}</td>
                  <td className="px-4 py-3">
                    <a
                      href={r.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                    >
                      GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
