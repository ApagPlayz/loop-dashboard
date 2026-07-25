"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import PageHeader from "@/components/page-header";
import { useProject } from "@/components/project-context";
import { Markdown, Spinner, ErrorPanel, EmptyState, relativeTime } from "@/components/queues/ui";
import type { LearningsPayload } from "@/app/api/learnings/route";

const LINE_CAP = 50;

export default function LearningsPage() {
  const { project } = useProject();
  const [data, setData] = useState<LearningsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/learnings?project=${encodeURIComponent(project)}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to load learnings");
      setData(payload as LearningsPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load learnings");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    // Defer so we don't call setState synchronously inside the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const capBadge = data?.markdown
    ? data.lineCount > LINE_CAP
      ? { text: `${data.lineCount} lines — over the ${LINE_CAP}-line cap`, cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" }
      : { text: `${data.lineCount} lines — under the ${LINE_CAP}-line cap`, cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" }
    : null;

  return (
    <>
      <PageHeader
        title="Learnings"
        description="What the loop has taught itself on this project — maintained by the Retro agent after every build."
        action={
          capBadge && (
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${capBadge.cls}`}
            >
              {capBadge.text}
            </span>
          )
        }
      />

      {loading && !data && (
        <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
          <Spinner /> Loading learnings…
        </div>
      )}

      {error && !data && <ErrorPanel message={error} onRetry={load} />}

      {data && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-zinc-300">LEARNINGS.md</h2>
            {data.markdown ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <Markdown>{data.markdown}</Markdown>
              </div>
            ) : (
              <EmptyState message="No learnings recorded yet — the Retro agent writes here after builds." />
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-zinc-300">Recent retros</h2>
            {data.retros.length === 0 ? (
              <EmptyState message="No retro history yet for LEARNINGS.md." />
            ) : (
              <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900">
                {data.retros.map((r) => (
                  <li key={r.sha} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-200">{r.message}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {r.author} · {relativeTime(r.date) || "unknown time"} ·{" "}
                        <span className="font-mono">{r.shortSha}</span>
                      </p>
                    </div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      GitHub
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
