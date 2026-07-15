"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Loader2,
  Check,
  ExternalLink,
  AlertTriangle,
  Clock,
  Play,
  Save,
  History,
  Info,
} from "lucide-react";
import type { AgentDetail } from "@/lib/map-types";
import { relativeTime, duration, runTone } from "./format";

type Tab = "overview" | "instructions" | "capabilities" | "run";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "instructions", label: "Instructions" },
  { id: "capabilities", label: "Abilities" },
  { id: "run", label: "Run now" },
];

export default function AgentDrawer({
  agentId,
  onClose,
  onRan,
}: {
  agentId: string | null;
  onClose: () => void;
  onRan?: () => void;
}) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/map/agent/${agentId}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Couldn't load this agent.");
      }
      setDetail(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (agentId) {
      // Reset to a clean panel and fetch when a different agent is opened.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab("overview");
      setDetail(null);
      load();
    }
  }, [agentId, load]);

  if (!agentId) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      {/* Panel: bottom sheet on mobile, right rail on desktop */}
      <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl border-t border-zinc-800 bg-zinc-950 shadow-2xl md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[480px] md:rounded-none md:border-l md:border-t-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-zinc-100">
              {detail?.meta.label ?? "Loading…"}
            </h2>
            {detail && (
              <p className="mt-0.5 text-xs text-zinc-500">{detail.meta.tagline}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-800 px-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-3 py-2.5 text-sm font-medium transition ${
                tab === t.id
                  ? "text-emerald-400"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-400" />
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && !detail ? (
            <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : error && !detail ? (
            <ErrorBox message={error} onRetry={load} />
          ) : detail ? (
            <>
              {tab === "overview" && <OverviewTab detail={detail} />}
              {tab === "instructions" && <InstructionsTab detail={detail} onSaved={load} />}
              {tab === "capabilities" && <CapabilitiesTab detail={detail} />}
              {tab === "run" && (
                <RunTab
                  detail={detail}
                  onRan={() => {
                    load();
                    onRan?.();
                  }}
                />
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function OverviewTab({ detail }: { detail: AgentDetail }) {
  return (
    <div className="space-y-5">
      <section>
        <p className="text-sm leading-relaxed text-zinc-300">{detail.meta.description}</p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          When it runs
        </h3>
        <ul className="space-y-1.5">
          {detail.meta.triggers.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              {t}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Recent runs
        </h3>
        {detail.runs.length === 0 ? (
          <p className="text-sm text-zinc-500">No runs recorded yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {detail.runs.map((r) => {
              const tone = runTone(r.status, r.conclusion);
              return (
                <li key={r.id}>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm transition hover:border-zinc-700 hover:bg-zinc-800/60"
                  >
                    <StatusDot tone={tone} />
                    <span className="flex-1 text-zinc-300">
                      {tone === "success"
                        ? "Passed"
                        : tone === "failure"
                          ? "Failed"
                          : tone === "running"
                            ? "Running"
                            : "Finished"}
                    </span>
                    <span className="text-xs text-zinc-500">{duration(r.durationSec)}</span>
                    <span className="w-20 text-right text-xs text-zinc-500">
                      {relativeTime(r.createdAt)}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusDot({ tone }: { tone: ReturnType<typeof runTone> }) {
  if (tone === "running") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-400" />;
  const color =
    tone === "success" ? "bg-emerald-400" : tone === "failure" ? "bg-red-400" : "bg-zinc-500";
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />;
}

/* ------------------------------------------------------------------ */
/* Instructions                                                        */
/* ------------------------------------------------------------------ */

function InstructionsTab({ detail, onSaved }: { detail: AgentDetail; onSaved: () => void }) {
  const canFriendly = detail.promptExtractable && detail.prompt !== null;
  // Default to raw when friendly editing isn't available.
  const [rawMode, setRawMode] = useState(!canFriendly);
  const [promptText, setPromptText] = useState(detail.prompt ?? "");
  const [rawText, setRawText] = useState(detail.rawYaml ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ commitUrl: string; historyUrl: string } | null>(null);

  const readOnly = !detail.editable;

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const bodyObj = rawMode
        ? { mode: "raw", rawYaml: rawText }
        : { mode: "prompt", prompt: promptText };
      const res = await fetch(`/api/map/agent/${detail.meta.id}/instructions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't save.");
      setSaved({ commitUrl: j.commitUrl, historyUrl: j.historyUrl });
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {readOnly && (
        <Banner tone="amber">
          These instructions can be read but not changed yet — this workflow is waiting for PR #44
          to be merged into the main branch.
        </Banner>
      )}
      {!detail.fileFound && (
        <Banner tone="red">
          The workflow file couldn&apos;t be found on GitHub.
        </Banner>
      )}
      {detail.fileFound && !canFriendly && (
        <Banner tone="amber">
          {detail.extractionNote
            ? `Simple editing isn't available for this file (${detail.extractionNote}). You're editing the full file directly — change carefully.`
            : "Simple editing isn't available for this file — you're editing the full file directly."}
        </Banner>
      )}

      {!rawMode ? (
        <>
          <label className="block text-xs font-medium text-zinc-400">
            What this agent is told to do. Plain instructions — edit freely.
          </label>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-emerald-500/50 disabled:opacity-60"
          />
        </>
      ) : (
        <>
          <label className="block text-xs font-medium text-zinc-400">
            Full workflow file (advanced). This is the raw YAML — a wrong edit can stop the agent
            running.
          </label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-200 outline-none focus:border-emerald-500/50 disabled:opacity-60"
          />
        </>
      )}

      {/* Advanced toggle (only when friendly editing is possible) */}
      {canFriendly && (
        <button
          onClick={() => setRawMode((v) => !v)}
          className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
        >
          {rawMode ? "← Back to simple editing" : "Advanced: edit the full file"}
        </button>
      )}

      {saveError && <Banner tone="red">{saveError}</Banner>}
      {saved && (
        <Banner tone="emerald">
          Saved to GitHub.{" "}
          <a
            className="underline"
            href={saved.commitUrl}
            target="_blank"
            rel="noreferrer"
          >
            View the change
          </a>
          .
        </Banner>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          disabled={readOnly || saving}
          onClick={save}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
        <a
          href={detail.historyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200"
        >
          <History className="h-3.5 w-3.5" /> History
        </a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

function CapabilitiesTab({ detail }: { detail: AgentDetail }) {
  const { tools, mcpServers, skills } = detail.capabilities;
  const empty = tools.length === 0 && mcpServers.length === 0 && skills.length === 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-400">
        The tools and connected services this agent can use. To add a new one, use the Tools
        section.
      </p>
      {empty ? (
        <p className="text-sm text-zinc-500">
          No special tools or services are configured for this workflow.
        </p>
      ) : (
        <>
          <ChipGroup title="Tools" chips={tools} tone="emerald" />
          <ChipGroup title="Connected services (MCP)" chips={mcpServers} tone="sky" />
          <ChipGroup title="Skills" chips={skills} tone="violet" />
        </>
      )}
    </div>
  );
}

function ChipGroup({
  title,
  chips,
  tone,
}: {
  title: string;
  chips: string[];
  tone: "emerald" | "sky" | "violet";
}) {
  if (chips.length === 0) return null;
  const toneCls = {
    emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
    sky: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
    violet: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  }[tone];
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c}
            className={`rounded-md px-2 py-1 font-mono text-xs ring-1 ring-inset ${toneCls}`}
          >
            {c}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Run now                                                             */
/* ------------------------------------------------------------------ */

function RunTab({ detail, onRan }: { detail: AgentDetail; onRan: () => void }) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const { meta } = detail;

  if (!meta.canDispatch) {
    return (
      <div className="space-y-3">
        <Banner tone="zinc">
          <Info className="mr-1 inline h-3.5 w-3.5" />
          This one can&apos;t be started by hand from here — it runs automatically on its own
          triggers (see the Overview tab).
        </Banner>
      </div>
    );
  }

  if (!meta.onMain) {
    return (
      <Banner tone="amber">
        This workflow can&apos;t be started yet — it&apos;s waiting for PR #44 to merge into the main
        branch. Once it&apos;s live, a &quot;Run now&quot; button will appear here.
      </Banner>
    );
  }

  const needsInput = meta.dispatch !== "none";

  async function run() {
    setRunning(true);
    setRunError(null);
    setStarted(false);
    try {
      const res = await fetch(`/api/map/agent/${meta.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(needsInput ? { input } : {}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't start the run.");
      setStarted(true);
      onRan();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Couldn't start the run.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        Start this agent right now, without waiting for its usual trigger.
      </p>

      {needsInput && (
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            {meta.dispatchInputLabel ?? "Number"}
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 42"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-500/50"
          />
          {meta.dispatchInputHelp && (
            <p className="mt-1 text-xs text-zinc-500">{meta.dispatchInputHelp}</p>
          )}
        </div>
      )}

      {runError && <Banner tone="red">{runError}</Banner>}
      {started && (
        <Banner tone="emerald">
          Started. The new run will show up in the Overview tab&apos;s recent runs in a few seconds.
        </Banner>
      )}

      <button
        disabled={running || (needsInput && !input.trim())}
        onClick={run}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Run now
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function Banner({
  tone,
  children,
}: {
  tone: "amber" | "red" | "emerald" | "zinc";
  children: React.ReactNode;
}) {
  const cls = {
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    red: "border-red-500/30 bg-red-500/10 text-red-200",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    zinc: "border-zinc-700 bg-zinc-800/50 text-zinc-300",
  }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${cls}`}>
      {(tone === "amber" || tone === "red") && (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      {tone === "emerald" && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3 py-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
      <p className="text-sm text-zinc-300">{message}</p>
      <button
        onClick={onRetry}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
      >
        Try again
      </button>
    </div>
  );
}
