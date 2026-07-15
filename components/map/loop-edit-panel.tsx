"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
  History,
  Check,
  AlertTriangle,
} from "lucide-react";
import type { FileChange } from "@/lib/map-types";
import { InlineDiff } from "./diff";
import HistoryList from "./history-list";
import { AGENTS } from "@/lib/map-agents";

/**
 * "Improve the loop with AI" + "Loop history", rendered below the map.
 * Two collapsible cards so the map stays the hero on a phone screen.
 */
export default function LoopEditPanel({ aiEnabled }: { aiEnabled: boolean | null }) {
  return (
    <div className="mt-4 space-y-3">
      <CollapsibleCard
        icon={<Sparkles className="h-4 w-4 text-emerald-400" />}
        title="Improve the loop with AI"
        subtitle="Describe a change to how the whole loop works — AI drafts it for your review."
      >
        <LoopEditForm aiEnabled={aiEnabled} />
      </CollapsibleCard>

      <CollapsibleCard
        icon={<History className="h-4 w-4 text-emerald-400" />}
        title="Loop history"
        subtitle="Every change ever made to the loop's workflows, with one-tap restore."
      >
        <HistoryList />
      </CollapsibleCard>
    </div>
  );
}

function CollapsibleCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-zinc-100">{title}</span>
          <span className="block truncate text-xs text-zinc-500">{subtitle}</span>
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
        )}
      </button>
      {open && <div className="border-t border-zinc-800 px-4 py-4">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AI loop editing                                                     */
/* ------------------------------------------------------------------ */

function fileLabel(file: string): string {
  return AGENTS.find((a) => a.file === file)?.label ?? file;
}

function LoopEditForm({ aiEnabled }: { aiEnabled: boolean | null }) {
  const [request, setRequest] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: string; changes: FileChange[] } | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedUrl, setAppliedUrl] = useState<string | null>(null);

  if (aiEnabled === false) {
    return (
      <p className="text-sm text-zinc-500">
        Add an Anthropic API key to turn on AI drafting — the History and manual editing still
        work. (Set ANTHROPIC_API_KEY where the dashboard runs.)
      </p>
    );
  }

  async function draft() {
    setDrafting(true);
    setError(null);
    setResult(null);
    setAppliedUrl(null);
    try {
      const res = await fetch("/api/map/loop-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't draft the change.");
      setResult({ summary: j.summary ?? "", changes: j.changes ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't draft the change.");
    } finally {
      setDrafting(false);
    }
  }

  async function apply() {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/map/loop-edit/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: result.summary,
          changes: result.changes.map((c) => ({ file: c.file, newContent: c.newContent })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't apply the change.");
      setAppliedUrl(j.commitUrl ?? null);
      setResult(null);
      setRequest("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply the change.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        placeholder='e.g. "Make Scout run twice a week and focus more on money-making ideas"'
        rows={3}
        className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
      />
      <button
        disabled={drafting || applying || !request.trim()}
        onClick={draft}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {drafting ? "Drafting… this can take a minute or two" : "Draft the change"}
      </button>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {appliedUrl && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Applied — the loop was updated in one change.{" "}
            <a className="underline" href={appliedUrl} target="_blank" rel="noreferrer">
              View it on GitHub
            </a>
            .
          </span>
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              What will change
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
              {result.summary || "(no summary provided)"}
            </p>
          </div>

          {result.changes.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No file changes were drafted — see the explanation above.
            </p>
          ) : (
            result.changes.map((c) => (
              <FileDiffBlock key={c.file} change={c} />
            ))
          )}

          <div className="flex gap-2 pt-1">
            {result.changes.length > 0 && (
              <button
                disabled={applying}
                onClick={apply}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Apply
              </button>
            )}
            <button
              disabled={applying}
              onClick={() => setResult(null)}
              className="rounded-lg border border-zinc-700 px-3.5 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileDiffBlock({ change }: { change: FileChange }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {fileLabel(change.file)}
        <span className="font-mono text-[10px] text-zinc-500">{change.file}</span>
      </button>
      {open && <InlineDiff oldText={change.oldContent ?? ""} newText={change.newContent} />}
    </div>
  );
}
