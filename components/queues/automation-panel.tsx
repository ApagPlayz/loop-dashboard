"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { LoopConfig } from "@/lib/loop-config";
import ToggleSwitch from "./toggle-switch";
import CapSlider from "./cap-slider";

/** The slice of the config this panel owns — the rest is left untouched. */
type OwnedFields = Pick<
  LoopConfig,
  "autonomousBuildEnabled" | "prCap" | "ideaQueueCap" | "demoPort"
>;

function owned(c: OwnedFields): OwnedFields {
  return {
    autonomousBuildEnabled: c.autonomousBuildEnabled,
    prCap: c.prCap,
    ideaQueueCap: c.ideaQueueCap,
    demoPort: c.demoPort,
  };
}

function sameConfig(a: OwnedFields, b: OwnedFields) {
  return (
    a.autonomousBuildEnabled === b.autonomousBuildEnabled &&
    a.prCap === b.prCap &&
    a.ideaQueueCap === b.ideaQueueCap &&
    a.demoPort === b.demoPort
  );
}

/**
 * `owned(draft)` as a wire-ready patch body: `demoPort` needs its own
 * explicit `null` for "clear it" because `JSON.stringify` silently drops a
 * key whose value is `undefined`, which the API instead reads as "don't
 * touch this field" (see lib/loop-config.ts's `setLoopConfig`).
 */
function patchBody(c: OwnedFields) {
  return { ...owned(c), demoPort: c.demoPort ?? null };
}

/**
 * "Automation for <project>" — the per-project controls for how much the
 * loop is allowed to do without a human approving first. Reads/writes
 * .github/loop-config.json (in that project's own repo) via /api/loop-config,
 * so two projects can never share or leak settings.
 *
 * Saves are fingerprinted: the panel sends back the fingerprint it loaded and
 * the API refuses (409) if the file moved on since. A 409 caused by a change
 * to a DIFFERENT part of the file (e.g. the Scout brief card) is retried
 * transparently; a real clash keeps the owner's typed values, rebases the
 * baseline/fingerprint onto the server's, and asks them to save again.
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
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<OwnedFields | null>(null);
  const [draft, setDraft] = useState<OwnedFields | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [capCount, setCapCount] = useState<number | null>(null);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Defer so we don't call setState synchronously inside the effect body
    // (same pattern as ideas-view.tsx's load effect).
    const t = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setNotice(null);
      setJustSaved(false);
      try {
        const res = await fetch(`/api/loop-config?project=${encodeURIComponent(project)}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Failed to load automation settings");
        if (cancelled) return;
        setSaved(owned(payload.config as LoopConfig));
        setDraft(owned(payload.config as LoopConfig));
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

  // How many builder slots are in use right now — shown next to the PR cap so
  // "3 max" means something concrete. Optional field: older payloads omit it.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setCapCount(null);
      try {
        const res = await fetch(`/api/builds?project=${encodeURIComponent(project)}`);
        const payload = (await res.json().catch(() => ({}))) as { capCount?: unknown };
        if (cancelled || !res.ok) return;
        if (typeof payload.capCount === "number" && Number.isFinite(payload.capCount)) {
          setCapCount(payload.capCount);
        }
      } catch {
        /* the slots line just doesn't show */
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

  const save = useCallback(
    async () => {
      if (!draft || !saved) return;
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/loop-config?project=${encodeURIComponent(project)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...patchBody(draft),
            ...(fingerprint ? { expectedFingerprint: fingerprint } : {}),
          }),
        });
        const payload = await res.json();

        if (res.status === 409 && payload?.config) {
          const server = owned(payload.config as LoopConfig);
          const serverFp =
            typeof payload.fingerprint === "string" ? payload.fingerprint : null;
          // Someone changed a different part of the file (e.g. the Scout
          // brief). Nothing of ours moved, so just re-stamp and save again.
          if (sameConfig(server, saved) && serverFp) {
            setFingerprint(serverFp);
            setSaving(false);
            // Retry with the fresh fingerprint.
            return void (await saveWithFingerprint(serverFp));
          }
          // A real clash: the server moved something we also touched. Keep the
          // owner's typed values exactly as they are — overwriting them here
          // would throw away work — and only rebase what we compare and send
          // against: the baseline and the fingerprint. The next save then
          // goes through, with the owner's edits winning.
          setSaved(server);
          if (serverFp) setFingerprint(serverFp);
          setNotice(
            "Settings changed elsewhere — your edits are still here; review and save again.",
          );
          return;
        }

        if (!res.ok) throw new Error(payload.error ?? "Failed to save");
        setSaved(owned(payload.config as LoopConfig));
        setDraft(owned(payload.config as LoopConfig));
        if (typeof payload.fingerprint === "string") setFingerprint(payload.fingerprint);
        setJustSaved(true);
        if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
        savedFlashTimer.current = setTimeout(() => setJustSaved(false), 2500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(false);
      }

      // Inner retry helper — one shot, with the fingerprint the server just
      // handed us.
      async function saveWithFingerprint(fp: string) {
        if (!draft) return;
        setSaving(true);
        try {
          const res = await fetch(`/api/loop-config?project=${encodeURIComponent(project)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...patchBody(draft), expectedFingerprint: fp }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error ?? "Failed to save");
          setSaved(owned(payload.config as LoopConfig));
          setDraft(owned(payload.config as LoopConfig));
          if (typeof payload.fingerprint === "string") setFingerprint(payload.fingerprint);
          setJustSaved(true);
          if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
          savedFlashTimer.current = setTimeout(() => setJustSaved(false), 2500);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to save");
        } finally {
          setSaving(false);
        }
      }
    },
    [draft, saved, fingerprint, project],
  );

  if (loading) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading automation settings…
      </div>
    );
  }

  if ((error && !draft) || !draft || !saved) {
    return (
      <div className="mb-4 rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
        Couldn&apos;t load automation settings{error ? `: ${error}` : ""}.
      </div>
    );
  }

  const dirty = !sameConfig(draft, saved);

  const cap = draft.ideaQueueCap === "unlimited" ? Infinity : draft.ideaQueueCap;
  const overCap = waitingCount >= cap && cap !== Infinity;
  const prCapNumber = draft.prCap === "unlimited" ? Infinity : draft.prCap;
  const slotsFull = capCount !== null && capCount >= prCapNumber;

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Automation for {projectLabel}
        </h3>
        <div className="flex items-center gap-3">
          {justSaved && !dirty && <span className="text-xs text-emerald-400">Saved</span>}
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save changes
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

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

        <div>
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
                  max={99}
                  value={draft.prCap}
                  onChange={(e) =>
                    // The API takes any positive integer, so the ceiling here
                    // is only a sanity rail — it must stay above anything
                    // already stored, or a saved 25 would collapse on the
                    // first keystroke.
                    setDraft({
                      ...draft,
                      prCap: Math.max(1, Math.min(99, Math.round(Number(e.target.value)) || 1)),
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
          {capCount !== null && (
            <p className={`mt-1 text-xs ${slotsFull ? "text-amber-400" : "text-zinc-500"}`}>
              Builder slots used: {capCount} /{" "}
              {draft.prCap === "unlimited" ? "∞" : draft.prCap}
              {slotsFull && " — the Builder is standing down until you clear one"}
            </p>
          )}
        </div>

        <div>
          <CapSlider
            value={draft.ideaQueueCap}
            onChange={(next) => setDraft((d) => (d ? { ...d, ideaQueueCap: next } : d))}
            onNormalize={(next) => {
              // Snapping a hand-edited cap onto the nearest stop is the
              // slider tidying its own display, not an edit the owner made —
              // so move the baseline with the draft and leave Save dark.
              setDraft((d) => (d ? { ...d, ideaQueueCap: next } : d));
              setSaved((s) => (s ? { ...s, ideaQueueCap: next } : s));
            }}
          />
          <p className={`mt-1 text-xs ${overCap ? "text-amber-400" : "text-zinc-500"}`}>
            {waitingCount} / {draft.ideaQueueCap === "unlimited" ? "∞" : draft.ideaQueueCap} in queue
            {overCap && " — the Scout will hold off filing new ones until this frees up"}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 border-t border-zinc-800 pt-4">
          <div className="min-w-0">
            <p className="text-sm text-zinc-300">App port for demo recordings</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Leave blank unless your app runs on a different port than 3000 when it starts
              locally.
            </p>
          </div>
          <input
            type="number"
            min={1}
            max={65535}
            placeholder="3000"
            value={draft.demoPort ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft({
                ...draft,
                demoPort:
                  raw === ""
                    ? undefined
                    : Math.max(1, Math.min(65535, Math.round(Number(raw)) || 1)),
              });
            }}
            className="w-20 shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-center text-sm text-zinc-100"
            aria-label="App port for demo recordings"
          />
        </div>
      </div>
    </div>
  );
}
