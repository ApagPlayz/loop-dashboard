"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitCommitHorizontal,
  BarChart3,
  Info,
} from "lucide-react";
import { shortDate } from "./format";

type Commit = {
  sha: string;
  message: string;
  author: string;
  date: string | null;
  htmlUrl: string;
  isDashboardEdit: boolean;
};
type Group = { file: string; name: string; commits: Commit[] };

type FilePatch = {
  filename: string;
  patch: string | null;
  additions: number;
  deletions: number;
};

type WindowStats = {
  count: number;
  merge_rate_pct: number | null;
  prs_merged: number | null;
  prs_rejected: number | null;
  median_pr_size_lines: number | null;
  proposal_approval_rate_pct: number | null;
};
type BeforeAfter = {
  before: WindowStats;
  after: WindowStats;
  thin: boolean;
  cutoff: string;
};

/* ---------- diff rendering ---------- */

function DiffView({ patch }: { patch: string | null }) {
  if (!patch) {
    return (
      <p className="text-xs text-zinc-500">
        No line-by-line change available (file may have been added or renamed).
      </p>
    );
  }
  const lines = patch.split("\n");
  return (
    <pre className="max-h-96 overflow-auto rounded-md border border-zinc-800 bg-black p-3 text-[11px] leading-relaxed">
      {lines.map((ln, i) => {
        let cls = "text-zinc-400";
        if (ln.startsWith("+") && !ln.startsWith("+++"))
          cls = "bg-emerald-500/10 text-emerald-300";
        else if (ln.startsWith("-") && !ln.startsWith("---"))
          cls = "bg-red-500/10 text-red-300";
        else if (ln.startsWith("@@")) cls = "text-sky-400";
        return (
          <div key={i} className={`whitespace-pre-wrap ${cls}`}>
            {ln || " "}
          </div>
        );
      })}
    </pre>
  );
}

/* ---------- before/after ---------- */

function delta(before: number | null, after: number | null, suffix = ""): string {
  if (before === null || after === null) return "Not enough data to compare.";
  const dir = after > before ? "up" : after < before ? "down" : "unchanged";
  return `${before}${suffix} → ${after}${suffix} (${dir})`;
}

/**
 * One in-flight request per (date, project), shared by every panel asking for
 * it. A template rollout touches eight-plus workflow files, so that single
 * commit appears as a row under every agent group — and one click on
 * "Before / after" mounted twenty panels that each fired the same request.
 * Twenty identical GitHub-backed calls for one answer. The sibling diff path
 * never had this problem because it reads from a keyed cache; this is that,
 * for the compare path.
 *
 * Keyed by date and project because both are in the URL. The entry is dropped
 * on failure so a transient error stays retryable rather than being cached as
 * a permanent one.
 */
const compareCache = new Map<string, Promise<unknown>>();

function fetchCompare(date: string, project: string): Promise<unknown> {
  const key = `${date}|${project}`;
  const hit = compareCache.get(key);
  if (hit) return hit;
  const p = fetch(
    `/api/testing/metrics-compare?date=${encodeURIComponent(date)}&project=${encodeURIComponent(project)}`,
    { cache: "no-store" },
  )
    .then((r) => r.json())
    .catch((e) => {
      compareCache.delete(key);
      throw e;
    });
  compareCache.set(key, p);
  return p;
}

function BeforeAfterPanel({ date, project }: { date: string; project: string }) {
  const [data, setData] = useState<BeforeAfter | { noMetrics: true } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    let live = true;
    fetchCompare(date, project)
      .then((raw) => {
        const d = raw as { error?: string } & BeforeAfter;
        if (!live) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => live && setError("Couldn't load metrics."));
    return () => {
      live = false;
    };
  }, [date, project]);

  if (error) return <p className="text-xs text-red-300">{error}</p>;
  if (!data) return <p className="text-xs text-zinc-500">Comparing metrics…</p>;
  if ("noMetrics" in data)
    return (
      <p className="text-xs text-zinc-500">
        No metrics snapshots saved yet, so there&apos;s nothing to compare.
      </p>
    );

  const { before, after, thin } = data;
  const rows: { label: string; b: number | null; a: number | null; suffix?: string }[] =
    [
      { label: "Merge rate", b: before.merge_rate_pct, a: after.merge_rate_pct, suffix: "%" },
      { label: "PRs merged (avg/day)", b: before.prs_merged, a: after.prs_merged },
      { label: "PRs rejected (avg)", b: before.prs_rejected, a: after.prs_rejected },
      { label: "Median PR size", b: before.median_pr_size_lines, a: after.median_pr_size_lines },
      {
        label: "Proposal approval",
        b: before.proposal_approval_rate_pct,
        a: after.proposal_approval_rate_pct,
        suffix: "%",
      },
    ];

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-zinc-500">
        {before.count} snapshot(s) before · {after.count} after this change.
      </p>
      {thin && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          Not enough data yet to be sure this change caused the difference — treat
          these numbers as a hint, not proof.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {r.label}
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums text-zinc-400">
                {r.b ?? "—"}
                {r.b !== null && r.suffix}
              </span>
              <span className="text-zinc-600">→</span>
              <span className="text-lg font-semibold tabular-nums text-zinc-100">
                {r.a ?? "—"}
                {r.a !== null && r.suffix}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              {delta(r.b, r.a, r.suffix ?? "")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- main ---------- */

export default function InstructionChanges({ project }: { project: string }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, FilePatch[] | "loading">>({});
  const [compareSha, setCompareSha] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    fetch(`/api/testing/instructions?project=${encodeURIComponent(project)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setGroups(d.groups ?? []);
      })
      .catch(() => setError("Couldn't load instruction history."));
  }, [project]);

  const toggleDiff = useCallback(
    async (sha: string) => {
      if (openSha === sha) {
        setOpenSha(null);
        return;
      }
      setOpenSha(sha);
      if (!diffs[sha]) {
        setDiffs((p) => ({ ...p, [sha]: "loading" }));
        try {
          const res = await fetch(
            `/api/testing/commit-diff?sha=${sha}&project=${encodeURIComponent(project)}`,
            { cache: "no-store" },
          );
          const d = await res.json();
          setDiffs((p) => ({ ...p, [sha]: d.files ?? [] }));
        } catch {
          setDiffs((p) => ({ ...p, [sha]: [] }));
        }
      }
    },
    [openSha, diffs, project],
  );

  return (
    <div className="space-y-6">
      {/* Explainer */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <div className="text-xs leading-relaxed text-zinc-400">
            <p className="font-medium text-zinc-300">
              Did my changes make the agents better?
            </p>
            <p className="mt-1">
              When you edit an agent&apos;s instructions, it shows up here. Pick a
              change to see the before/after numbers. The metrics that matter:{" "}
              <strong className="text-zinc-300">merge rate</strong> (how often the
              agent&apos;s work is good enough to keep),{" "}
              <strong className="text-zinc-300">PR size</strong> (how big each
              change is), and{" "}
              <strong className="text-zinc-300">proposal approval</strong> (how
              often its ideas are worth doing).
            </p>
            <p className="mt-1 text-amber-300/90">
              Watch for PR size climbing while merge rate falls — that means the
              loop is going bad, not better.
            </p>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {!groups && !error && (
        <p className="text-sm text-zinc-500">Loading changes…</p>
      )}
      {groups && groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/50 p-5 text-sm text-zinc-500">
          No instruction changes recorded yet. When you edit an agent&apos;s
          instructions from the dashboard, the history will appear here.
        </p>
      )}

      {groups?.map((g) => (
        <section key={g.file}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-300">
            <GitCommitHorizontal className="h-4 w-4 text-zinc-500" />
            {g.name}
            <span className="font-mono text-[11px] font-normal text-zinc-600">
              {g.file}
            </span>
          </h3>
          <div className="space-y-2">
            {g.commits.map((c) => {
              const open = openSha === c.sha;
              const diff = diffs[c.sha];
              return (
                <div
                  key={c.sha}
                  className="rounded-lg border border-zinc-800 bg-zinc-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm text-zinc-200">
                        <span className="truncate">{c.message}</span>
                        {c.isDashboardEdit && (
                          <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            dashboard edit
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {shortDate(c.date)} · {c.author} ·{" "}
                        <span className="font-mono">{c.sha.slice(0, 7)}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleDiff(c.sha)}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                      >
                        {open ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        View what changed
                      </button>
                      <button
                        onClick={() =>
                          setCompareSha(compareSha === c.sha ? null : c.sha)
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                      >
                        <BarChart3 className="h-3 w-3" />
                        Before / after
                      </button>
                      <a
                        href={c.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-500 hover:text-emerald-400"
                        title="Open on GitHub"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>

                  {open && (
                    <div className="border-t border-zinc-800 px-3 py-2">
                      {diff === "loading" && (
                        <p className="text-xs text-zinc-500">Loading change…</p>
                      )}
                      {Array.isArray(diff) &&
                        diff.length === 0 &&
                        diff !== undefined && (
                          <p className="text-xs text-zinc-500">
                            This commit didn&apos;t change a workflow file
                            directly.
                          </p>
                        )}
                      {Array.isArray(diff) &&
                        diff.map((f) => (
                          <div key={f.filename} className="mb-3">
                            <p className="mb-1 font-mono text-[11px] text-zinc-500">
                              {f.filename}{" "}
                              <span className="text-emerald-400">
                                +{f.additions}
                              </span>{" "}
                              <span className="text-red-400">
                                -{f.deletions}
                              </span>
                            </p>
                            <DiffView patch={f.patch} />
                          </div>
                        ))}
                    </div>
                  )}

                  {compareSha === c.sha && c.date && (
                    <div className="border-t border-zinc-800 px-3 py-3">
                      <BeforeAfterPanel date={c.date} project={project} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
