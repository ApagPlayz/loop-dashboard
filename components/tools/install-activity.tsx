"use client";

import { useEffect, useState } from "react";
import { ExternalLink, GitPullRequest } from "lucide-react";
import StatusBadge from "@/components/testing/status-badge";
import { relativeTime } from "@/components/testing/format";
import { useProject } from "@/components/project-context";

type RunSummary = {
  id: number;
  displayName: string;
  status: string | null;
  conclusion: string | null;
  createdAt: string;
  htmlUrl: string;
};
type ToolPr = {
  number: number;
  title: string;
  branch: string;
  htmlUrl: string;
  createdAt: string;
};

export default function InstallActivity() {
  const { project } = useProject();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [prs, setPrs] = useState<ToolPr[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(false);
    fetch(`/api/tools/activity?project=${encodeURIComponent(project)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setRuns(d.runs ?? []);
        setPrs(d.prs ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  return (
    <div className="space-y-4">
      {/* Tool PRs */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Builds waiting for approval
        </h3>
        {prs.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No tool-install builds open right now.
          </p>
        ) : (
          <div className="space-y-2">
            {prs.map((pr) => (
              <div
                key={pr.number}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm text-zinc-200">
                    <GitPullRequest className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span className="truncate">{pr.title}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    #{pr.number} · {relativeTime(pr.createdAt)}
                  </p>
                </div>
                <a
                  href="/builds"
                  className="shrink-0 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-zinc-800"
                >
                  Review in Builds
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Install runs */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Recent install runs
        </h3>
        {!loaded ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No installs have run yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {runs.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} conclusion={r.conclusion} />
                  <span className="text-xs text-zinc-500">
                    {relativeTime(r.createdAt)}
                  </span>
                </div>
                <a
                  href={r.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                >
                  GitHub <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
