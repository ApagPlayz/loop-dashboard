"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import StatusBadge from "./status-badge";
import { duration } from "./format";

type JobStep = {
  name: string;
  status: string | null;
  conclusion: string | null;
  number: number;
};
type JobSummary = {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
  steps: JobStep[];
};

type LogState =
  | { loading: true }
  | { available: true; tail: string; totalLines: number }
  | { available: false; reason: string };

/**
 * Live view of a single run: polls its jobs every 5s while anything is still
 * running, shows step-by-step progress, and offers a log tail once a job is
 * finished (GitHub won't serve logs for a job that's still in progress).
 */
export default function RunDetail({
  runId,
  htmlUrl,
  project,
}: {
  runId: number;
  htmlUrl: string;
  project: string;
}) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<number | null>(null);
  const [logs, setLogs] = useState<Record<number, LogState>>({});

  const load = useCallback(async () => {
    if (!project) return;
    try {
      const res = await fetch(
        `/api/testing/run/${runId}/jobs?project=${encodeURIComponent(project)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setJobs(data.jobs);
      setError(null);
    } catch {
      setError("Couldn't load this run's progress.");
    }
  }, [runId, project]);

  // Initial load. The parent remounts this component (via a key) when runId
  // changes, so we don't reset state here.
  useEffect(() => {
    if (!project) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [project, load]);

  // Poll while any job is unfinished.
  useEffect(() => {
    if (!project) return;
    const anyRunning =
      jobs === null || jobs.some((j) => j.status !== "completed");
    if (!anyRunning) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [project, jobs, load]);

  const fetchLog = useCallback(
    async (jobId: number) => {
      if (!project) return;
      setLogs((p) => ({ ...p, [jobId]: { loading: true } }));
      try {
        const res = await fetch(
          `/api/testing/run/${runId}/logs?job=${jobId}&lines=200&project=${encodeURIComponent(project)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (data.available) {
          setLogs((p) => ({
            ...p,
            [jobId]: {
              available: true,
              tail: data.tail,
              totalLines: data.totalLines,
            },
          }));
        } else {
          setLogs((p) => ({
            ...p,
            [jobId]: {
              available: false,
              reason: data.reason ?? "Logs not available.",
            },
          }));
        }
      } catch {
        setLogs((p) => ({
          ...p,
          [jobId]: { available: false, reason: "Couldn't load logs." },
        }));
      }
    },
    [runId, project],
  );

  if (error) {
    return <p className="text-sm text-red-300">{error}</p>;
  }
  if (jobs === null) {
    return <p className="text-sm text-zinc-500">Loading progress…</p>;
  }
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No jobs yet — the run is still starting up.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => {
        const isOpen = openJob === job.id;
        const finished = job.status === "completed";
        const log = logs[job.id];
        return (
          <div
            key={job.id}
            className="rounded-lg border border-zinc-800 bg-zinc-950/40"
          >
            <button
              onClick={() => setOpenJob(isOpen ? null : job.id)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
            >
              <span className="flex items-center gap-2 min-w-0">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                )}
                <span className="truncate text-sm font-medium text-zinc-200">
                  {job.name}
                </span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-zinc-500 tabular-nums">
                  {duration(job.startedAt, job.completedAt)}
                </span>
                <StatusBadge status={job.status} conclusion={job.conclusion} />
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-zinc-800 px-3 py-2">
                <ul className="space-y-1">
                  {job.steps.map((s) => (
                    <li
                      key={s.number}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="truncate text-zinc-400">{s.name}</span>
                      <StatusBadge
                        status={s.status}
                        conclusion={s.conclusion}
                      />
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {finished ? (
                    <button
                      onClick={() => fetchLog(job.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                    >
                      <ScrollText className="h-3.5 w-3.5" />
                      {log && "available" in log && log.available
                        ? "Refresh log"
                        : "Show last 200 lines"}
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-500">
                      Logs appear once this job finishes — showing step progress
                      above meanwhile.
                    </span>
                  )}
                  {job.htmlUrl && (
                    <a
                      href={job.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                    >
                      Open full log on GitHub
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {log && "loading" in log && (
                  <p className="mt-2 text-xs text-zinc-500">Loading log…</p>
                )}
                {log && "available" in log && !log.available && (
                  <p className="mt-2 text-xs text-zinc-500">{log.reason}</p>
                )}
                {log && "available" in log && log.available && (
                  <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-zinc-800 bg-black p-3 text-[11px] leading-relaxed text-zinc-300">
                    {log.tail || "(empty)"}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}
      <a
        href={htmlUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
      >
        Open this run on GitHub
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
