"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import ToggleSwitch from "./toggle-switch";
import CapSlider from "./cap-slider";

type LoopConfig = {
  version: number;
  autonomousBuildEnabled: boolean;
  prCap: number | "unlimited";
  ideaQueueCap: number | "unlimited";
};

function sameConfig(a: LoopConfig, b: LoopConfig) {
  return (
    a.autonomousBuildEnabled === b.autonomousBuildEnabled &&
    a.prCap === b.prCap &&
    a.ideaQueueCap === b.ideaQueueCap
  );
}

/**
 * "Automation for <project>" — the per-project controls for how much the
 * loop is allowed to do without a human approving first. Reads/writes
 * .github/loop-config.json (in that project's own repo) via /api/loop-config,
 * so two projects can never share or leak settings.
 */
export default function AutomationPanel({
  project,
  projectLabel,
  waitingCount,
}: {
  project: string;
  projectLabel: string;
  waitingCount: number;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<LoopConfig | null>(null);
  const [draft, setDraft] = useState<LoopConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Defer so we don't call setState synchronously inside the effect body
    // (same pattern as ideas-view.tsx's load effect).
    const t = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setJustSaved(false);
      try {
        const res = await fetch(`/api/loop-config?project=${encodeURIComponent(project)}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Failed to load automation settings");
        if (cancelled) return;
        setSaved(payload.config as LoopConfig);
        setDraft(payload.config as LoopConfig);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [project]);

  useEffect(() => () => {
    if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
  }, []);

  if (loading) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading automation settings…
      </div>
    );
  }

  if (error || !draft || !saved) {
    return (
      <div className="mb-4 rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
        Couldn&apos;t load automation settings{error ? `: ${error}` : ""}.
      </div>
    );
  }

  const dirty = !sameConfig(draft, saved);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/loop-config?project=${encodeURIComponent(project)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to save");
      setSaved(payload.config as LoopConfig);
      setDraft(payload.config as LoopConfig);
      setJustSaved(true);
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const cap = draft.ideaQueueCap === "unlimited" ? Infinity : draft.ideaQueueCap;
  const overCap = waitingCount >= cap && cap !== Infinity;

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Automation for {projectLabel}
        </h3>
        <div className="flex items-center gap-3">
          {justSaved && !dirty && <span className="text-xs text-emerald-400">Saved</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save changes
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-zinc-300">Autonomous build</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {draft.autonomousBuildEnabled
                ? "ON — the Builder may pick its own best idea from the queue and build it, any time of day, if nothing is approved."
                : "OFF — the Builder only ever builds ideas you've explicitly approved. Nothing builds on its own."}
            </p>
          </div>
          <ToggleSwitch
            checked={draft.autonomousBuildEnabled}
            onChange={(next) => setDraft({ ...draft, autonomousBuildEnabled: next })}
            label="Toggle autonomous build"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-300">Review queue cap</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {draft.prCap === "unlimited"
                ? "No limit — Builder keeps going no matter how many PRs are already awaiting you."
                : "Max builder pull requests open and waiting on you at once."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {draft.prCap !== "unlimited" && (
              <input
                type="number"
                min={1}
                max={10}
                value={draft.prCap}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    prCap: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                  })
                }
                className="w-16 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-center text-sm text-zinc-100"
              />
            )}
            <label className="flex items-center gap-1.5 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={draft.prCap === "unlimited"}
                onChange={(e) =>
                  setDraft({ ...draft, prCap: e.target.checked ? "unlimited" : 3 })
                }
                className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-emerald-500"
              />
              Unlimited
            </label>
          </div>
        </div>

        <div>
          <CapSlider
            value={draft.ideaQueueCap}
            onChange={(next) => setDraft({ ...draft, ideaQueueCap: next })}
          />
          <p className={`mt-1 text-xs ${overCap ? "text-amber-400" : "text-zinc-500"}`}>
            {waitingCount} / {draft.ideaQueueCap === "unlimited" ? "∞" : draft.ideaQueueCap} in queue
            {overCap && " — the Scout will hold off filing new ones until this frees up"}
          </p>
        </div>
      </div>
    </div>
  );
}
