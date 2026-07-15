"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Check,
  AlertTriangle,
} from "lucide-react";
import type { HistoryCommit } from "@/lib/map-types";
import { relativeTime } from "./format";
import { PatchView } from "./diff";

type Patch = { filename: string; status: string; patch: string | null };

/**
 * List of past versions (commits) with expandable diffs and a "Restore this
 * version" action. Used for one agent's file (pass `file`) or the whole loop
 * (omit it). A restore is always a NEW commit — nothing is ever deleted.
 */
export default function HistoryList({
  file,
  onRestored,
}: {
  /** Workflow filename to scope to; omit for the whole workflows folder. */
  file?: string;
  onRestored?: () => void;
}) {
  const [commits, setCommits] = useState<HistoryCommit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setCommits(null);
    try {
      const qs = file ? `file=${encodeURIComponent(file)}` : "scope=loop";
      const res = await fetch(`/api/map/history?${qs}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't load the history.");
      setCommits(j.commits ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the history.");
    }
  }, [file]);

  useEffect(() => {
    // Fetch history from GitHub (an external system) on mount / file change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-2 py-4 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-red-400" />
        <p className="text-sm text-zinc-300">{error}</p>
        <button
          onClick={load}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Try again
        </button>
      </div>
    );
  }
  if (commits === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
      </div>
    );
  }
  if (commits.length === 0) {
    return <p className="py-4 text-sm text-zinc-500">No past versions found yet.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Every saved change, newest first. Restoring puts things back exactly as they were —
        nothing is deleted, and you can always restore any version again.
      </p>
      <ul className="space-y-1.5">
        {commits.map((c, idx) => (
          <CommitRow
            key={c.sha}
            commit={c}
            file={file}
            isCurrent={idx === 0}
            onRestored={() => {
              load();
              onRestored?.();
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function CommitRow({
  commit,
  file,
  isCurrent,
  onRestored,
}: {
  commit: HistoryCommit;
  file?: string;
  isCurrent: boolean;
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [patches, setPatches] = useState<Patch[] | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoredUrl, setRestoredUrl] = useState<string | null>(null);

  async function toggleDiff() {
    const next = !open;
    setOpen(next);
    if (next && patches === null && !diffError) {
      try {
        const qs = file ? `?file=${encodeURIComponent(file)}` : "";
        const res = await fetch(`/api/map/history/${commit.sha}${qs}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? "Couldn't load the change.");
        setPatches(j.patches ?? []);
      } catch (e) {
        setDiffError(e instanceof Error ? e.message : "Couldn't load the change.");
      }
    }
  }

  async function restore() {
    setRestoring(true);
    setRestoreError(null);
    try {
      const res = await fetch("/api/map/history/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(file ? { sha: commit.sha, file } : { sha: commit.sha }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't restore.");
      setRestoredUrl(j.commitUrl ?? null);
      setConfirming(false);
      onRestored();
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : "Couldn't restore.");
    } finally {
      setRestoring(false);
    }
  }

  const dateLabel = commit.date
    ? new Date(commit.date).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "unknown date";

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
      <div className="flex items-start gap-2">
        <button
          onClick={toggleDiff}
          className="mt-0.5 shrink-0 text-zinc-500 hover:text-zinc-200"
          aria-label="View change"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm text-zinc-200">{commit.message}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {relativeTime(commit.date)} · {dateLabel}
            {isCurrent && <span className="ml-1.5 text-emerald-400">· current version</span>}
          </p>
        </div>
        <a
          href={commit.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 p-1 text-zinc-500 hover:text-zinc-200"
          aria-label="Open on GitHub"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {open && (
        <div className="mt-2 space-y-2 pl-6">
          {diffError ? (
            <p className="text-xs text-red-300">{diffError}</p>
          ) : patches === null ? (
            <p className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading the change…
            </p>
          ) : patches.length === 0 ? (
            <p className="text-xs text-zinc-500">No workflow changes in this version.</p>
          ) : (
            patches.map((p) => (
              <div key={p.filename}>
                <p className="mb-1 font-mono text-[11px] text-zinc-400">
                  {p.filename.replace(/^\.github\/workflows\//, "")}
                  {p.status !== "modified" && (
                    <span className="ml-1.5 text-zinc-500">({p.status})</span>
                  )}
                </p>
                <PatchView patch={p.patch} />
              </div>
            ))
          )}

          {!isCurrent && !restoredUrl && (
            <div>
              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Restore this version
                </button>
              ) : (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                  <p>
                    This puts {file ? "the instructions" : "ALL the loop's workflow files"} back
                    exactly as they were on {dateLabel}. Nothing is deleted — you can always
                    restore any version.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={restoring}
                      onClick={restore}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1.5 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {restoring ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      Yes, restore
                    </button>
                    <button
                      disabled={restoring}
                      onClick={() => setConfirming(false)}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {restoreError && <p className="text-xs text-red-300">{restoreError}</p>}
          {restoredUrl && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-300">
              <Check className="h-3.5 w-3.5" /> Restored.{" "}
              <a className="underline" href={restoredUrl} target="_blank" rel="noreferrer">
                View the change
              </a>
            </p>
          )}
        </div>
      )}
    </li>
  );
}
