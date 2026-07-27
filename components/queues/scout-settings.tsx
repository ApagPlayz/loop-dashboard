"use client";

/**
 * "What should the Scout look for?" — the per-project scouting brief, stored in
 * the `scout` block of that project's own `.github/loop-config.json` and read
 * by the Scout workflow at runtime. Without it the Scout only knows the repo
 * name and a cap number, so it guesses what matters; with it, ideas are aimed
 * at this product and these goals.
 *
 * Sits beside AutomationPanel on the Ideas page and shares its look, its
 * load/save shape (/api/loop-config) and its fingerprint concurrency flow.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, X } from "lucide-react";
import type { LoopConfig, ScoutConfig } from "@/lib/loop-config";

const DEFAULT_SCOUT: ScoutConfig = {
  productSummary: "",
  currentGoals: [],
  offLimits: [],
  lenses: [],
  maxPerRun: 3,
};

/** Starter angles offered as one-tap chips — nothing is applied until saved. */
const LENS_SUGGESTIONS = [
  "How well it keeps people watching",
  "What each run costs to produce",
  "Platform rule changes",
  "Quality as a viewer would judge it",
  "Things breaking outside our control",
  "Money left on the table",
  "What competitors just shipped",
  "A new user's first ten minutes",
];

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameScout(a: ScoutConfig, b: ScoutConfig) {
  return (
    a.productSummary === b.productSummary &&
    a.maxPerRun === b.maxPerRun &&
    sameList(a.currentGoals, b.currentGoals) &&
    sameList(a.offLimits, b.offLimits) &&
    sameList(a.lenses, b.lenses)
  );
}

function readScout(config: LoopConfig | undefined): ScoutConfig {
  const s = config?.scout;
  if (!s || typeof s !== "object") return { ...DEFAULT_SCOUT };
  return {
    productSummary: typeof s.productSummary === "string" ? s.productSummary : "",
    currentGoals: Array.isArray(s.currentGoals) ? s.currentGoals : [],
    offLimits: Array.isArray(s.offLimits) ? s.offLimits : [],
    lenses: Array.isArray(s.lenses) ? s.lenses : [],
    maxPerRun:
      typeof s.maxPerRun === "number" && Number.isInteger(s.maxPerRun) ? s.maxPerRun : 3,
  };
}

export default function ScoutSettings({
  project,
  projectLabel,
}: {
  project: string;
  projectLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<ScoutConfig | null>(null);
  const [draft, setDraft] = useState<ScoutConfig | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Defer so we don't call setState synchronously inside the effect body
    // (same pattern as automation-panel.tsx).
    const t = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setNotice(null);
      setJustSaved(false);
      try {
        const res = await fetch(`/api/loop-config?project=${encodeURIComponent(project)}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Failed to load the Scout brief");
        if (cancelled) return;
        const scout = readScout(payload.config as LoopConfig);
        setSaved(scout);
        setDraft(scout);
        setFingerprint(typeof payload.fingerprint === "string" ? payload.fingerprint : null);
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

  const flashSaved = useCallback(() => {
    setJustSaved(true);
    if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    savedFlashTimer.current = setTimeout(() => setJustSaved(false), 2500);
  }, []);

  const save = useCallback(async () => {
    if (!draft || !saved) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const put = async (fp: string | null) => {
      const res = await fetch(`/api/loop-config?project=${encodeURIComponent(project)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scout: draft,
          ...(fp ? { expectedFingerprint: fp } : {}),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      return { res, payload } as {
        res: Response;
        payload: { config?: LoopConfig; fingerprint?: string; error?: string };
      };
    };

    try {
      let { res, payload } = await put(fingerprint);

      if (res.status === 409 && payload.config) {
        const server = readScout(payload.config);
        const serverFp = typeof payload.fingerprint === "string" ? payload.fingerprint : null;
        if (sameScout(server, saved) && serverFp) {
          // The clash was in a different part of the file (the Automation
          // panel). Nothing of ours moved — re-stamp and save once more.
          ({ res, payload } = await put(serverFp));
        } else {
          // A real clash. The draft holds typed prose — a whole product
          // summary, goals, angles — so it stays exactly as the owner left
          // it. Only the baseline and the fingerprint rebase onto the
          // server's, which is enough for the next save to land.
          setSaved(server);
          if (serverFp) setFingerprint(serverFp);
          setNotice(
            "Settings changed elsewhere — your edits are still here; review and save again.",
          );
          return;
        }
      }

      if (!res.ok || !payload.config) {
        throw new Error(payload.error ?? "Failed to save");
      }
      const next = readScout(payload.config);
      setSaved(next);
      setDraft(next);
      if (typeof payload.fingerprint === "string") setFingerprint(payload.fingerprint);
      flashSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [draft, saved, fingerprint, project, flashSaved]);

  if (loading) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the Scout brief…
      </div>
    );
  }

  if (!draft || !saved) {
    return (
      <div className="mb-4 rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
        Couldn&apos;t load the Scout brief{error ? `: ${error}` : ""}.
      </div>
    );
  }

  const dirty = !sameScout(draft, saved);
  const configured =
    saved.productSummary.trim().length > 0 ||
    saved.currentGoals.length > 0 ||
    saved.lenses.length > 0;

  const summaryLine = configured
    ? [
        `${saved.currentGoals.length} goal${saved.currentGoals.length === 1 ? "" : "s"}`,
        `${saved.lenses.length} angle${saved.lenses.length === 1 ? "" : "s"}`,
        `up to ${saved.maxPerRun} idea${saved.maxPerRun === 1 ? "" : "s"} per run`,
      ].join(" · ")
    : "Not set up yet — the Scout is guessing what matters to you.";

  const update = (patch: Partial<ScoutConfig>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={open}
        >
          <span className="mt-0.5 shrink-0 text-zinc-500">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
              What should the Scout look for?
            </span>
            <span
              className={`mt-0.5 block text-xs ${configured ? "text-zinc-500" : "text-amber-400"}`}
            >
              {summaryLine}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-3">
          {justSaved && !dirty && <span className="text-xs text-emerald-400">Saved</span>}
          {(open || dirty) && (
            <button
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Save changes
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-5">
          <p className="text-xs text-zinc-500">
            Every hour the Scout reads {projectLabel}&apos;s code and files ideas for you. This
            is what you&apos;d tell a new teammate on their first day — it goes straight into
            the Scout&apos;s instructions.
          </p>

          {/* Product summary */}
          <div>
            <label className="mb-1.5 block text-sm text-zinc-300">
              What is this product, in a nutshell?
            </label>
            <textarea
              value={draft.productSummary}
              onChange={(e) => update({ productSummary: e.target.value })}
              rows={3}
              disabled={saving}
              placeholder="e.g. Turns one long video into short clips for TikTok and YouTube. Built for solo creators who post daily."
              className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Who it&apos;s for and what it does. A few sentences is plenty.
            </p>
          </div>

          {/* Goals */}
          <TagField
            label="What matters most right now?"
            help="Ideas that move these get proposed first."
            placeholder="e.g. Keep viewers watching to the end"
            values={draft.currentGoals}
            onChange={(currentGoals) => update({ currentGoals })}
            disabled={saving}
            tone="emerald"
          />

          {/* Off limits */}
          <TagField
            label="Anything it should leave alone?"
            help="The Scout won't propose work here at all."
            placeholder="e.g. Don't touch billing or payments"
            values={draft.offLimits}
            onChange={(offLimits) => update({ offLimits })}
            disabled={saving}
            tone="red"
          />

          {/* Lenses */}
          <TagField
            label="Angles to look from"
            help="The Scout rotates through these run to run. Leave empty and it picks its own."
            placeholder="Add your own angle…"
            values={draft.lenses}
            onChange={(lenses) => update({ lenses })}
            disabled={saving}
            tone="sky"
            suggestions={LENS_SUGGESTIONS}
          />

          {/* Max per run */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-zinc-300">How many ideas per run, at most?</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                A few well-researched ideas beat a long list. Three is a good default.
              </p>
            </div>
            <input
              type="number"
              min={1}
              max={10}
              value={draft.maxPerRun}
              disabled={saving}
              onChange={(e) =>
                update({
                  maxPerRun: Math.max(1, Math.min(10, Math.round(Number(e.target.value)) || 1)),
                })
              }
              className="w-16 shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-center text-sm text-zinc-100 disabled:opacity-50"
              aria-label="Maximum ideas per Scout run"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tag field — a plain list of short lines, entered one at a time       */
/* ------------------------------------------------------------------ */

const TONES: Record<string, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  red: "border-red-500/30 bg-red-500/10 text-red-200",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-200",
};

function TagField({
  label,
  help,
  placeholder,
  values,
  onChange,
  disabled,
  tone,
  suggestions,
}: {
  label: string;
  help: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  tone: keyof typeof TONES | string;
  suggestions?: string[];
}) {
  const [input, setInput] = useState("");
  const chip = TONES[tone] ?? TONES.sky;

  function add(raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (values.some((v) => v.toLowerCase() === text.toLowerCase())) {
      setInput("");
      return;
    }
    onChange([...values, text]);
    setInput("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(input);
    } else if (e.key === "Backspace" && !input && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  const unused = (suggestions ?? []).filter(
    (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div>
      <label className="mb-1.5 block text-sm text-zinc-300">{label}</label>

      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${chip}`}
            >
              {v}
              <button
                onClick={() => onChange(values.filter((x) => x !== v))}
                disabled={disabled}
                aria-label={`Remove ${v}`}
                className="ml-0.5 rounded-full p-0.5 transition hover:bg-black/20 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(input)}
          disabled={disabled}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={() => add(input)}
          disabled={disabled || !input.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{help} Press Enter to add each one.</p>

      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unused.map((s) => (
            <button
              key={s}
              onClick={() => add(s)}
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              <Plus className="h-3 w-3" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
