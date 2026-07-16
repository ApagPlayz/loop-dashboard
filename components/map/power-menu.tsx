"use client";

import { useCallback, useEffect, useState } from "react";
import { Power, Loader2, X, AlertTriangle } from "lucide-react";
import Modal from "./modal";

type WorkflowPower = {
  file: string;
  name: string;
  state: string;
  enabled: boolean;
  isMention: boolean;
};

/**
 * The loop power menu: master pause/resume plus per-workflow switches for the
 * selected project. Opens as a bottom sheet on mobile / small panel on desktop.
 */
export default function PowerMenu({
  project,
  loopPaused,
  onChanged,
}: {
  project: string;
  loopPaused: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
          loopPaused
            ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
            : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
        }`}
        title="Loop power"
      >
        <Power className="h-3.5 w-3.5" />
        {loopPaused ? "Paused" : "Power"}
      </button>
      {open && <PowerSheet project={project} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

function PowerSheet({
  project,
  onClose,
  onChanged,
}: {
  project: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowPower[] | null>(null);
  const [loopPaused, setLoopPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "master" | file
  const [confirmingPause, setConfirmingPause] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/map/power?project=${encodeURIComponent(project)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't read the switches.");
      setWorkflows(j.workflows ?? []);
      setLoopPaused(!!j.loopPaused);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the switches.");
    }
  }, [project]);

  useEffect(() => {
    // Read current switch state from GitHub when the sheet opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function post(body: unknown, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(`/api/map/power?project=${encodeURIComponent(project)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't flip the switch.");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't flip the switch.");
    } finally {
      setBusy(null);
      setConfirmingPause(false);
    }
  }

  return (
    <Modal onClose={onClose} className="h-[95vh] w-[95vw] sm:h-auto sm:max-h-[85vh] sm:w-[90vw] sm:max-w-[560px]">
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
          <Power className="h-4 w-4 text-emerald-400" /> Loop power
        </h2>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </div>
          )}

          {/* Master switch */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5">
            <p className="text-sm font-semibold text-zinc-100">
              {loopPaused ? "The loop is paused" : "The loop is running"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {loopPaused
                ? "Switch it back on and the agents pick up where they left off."
                : "Pausing switches every agent off. Nothing is deleted — agents just stop running until you switch back on. Anything already running finishes."}
            </p>
            {!loopPaused && !confirmingPause && (
              <button
                disabled={busy !== null}
                onClick={() => setConfirmingPause(true)}
                className="mt-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
              >
                Pause entire loop
              </button>
            )}
            {!loopPaused && confirmingPause && (
              <div className="mt-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                <p>
                  Pause everything? @claude replies stay on so you can still reach Claude from
                  GitHub — switch it off individually below if you want total silence.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={busy !== null}
                    onClick={() => post({ action: "pause" }, "master")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
                  >
                    {busy === "master" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Yes, pause the loop
                  </button>
                  <button
                    disabled={busy !== null}
                    onClick={() => setConfirmingPause(false)}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {loopPaused && (
              <button
                disabled={busy !== null}
                onClick={() => post({ action: "resume" }, "master")}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {busy === "master" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Resume loop
              </button>
            )}
          </div>

          {/* Per-workflow switches */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Individual switches
            </p>
            {workflows === null ? (
              <p className="flex items-center gap-2 py-3 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading the switches…
              </p>
            ) : workflows.length === 0 ? (
              <p className="py-2 text-sm text-zinc-500">No loop workflows in this project yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {workflows.map((w) => (
                  <li
                    key={w.file}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-200">{w.name}</p>
                      <p className="truncate font-mono text-[10px] text-zinc-500">
                        {w.file}
                        {w.isMention && " · your phone remote control"}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-medium ${w.enabled ? "text-emerald-400" : "text-zinc-500"}`}
                    >
                      {w.enabled ? "On" : "Off"}
                    </span>
                    <button
                      disabled={busy !== null}
                      onClick={() => post({ file: w.file, enable: !w.enabled }, w.file)}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${
                        w.enabled ? "bg-emerald-500" : "bg-zinc-700"
                      }`}
                      aria-label={`Turn ${w.name} ${w.enabled ? "off" : "on"}`}
                    >
                      {busy === w.file ? (
                        <Loader2 className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-zinc-100" />
                      ) : (
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-zinc-100 transition-all ${
                            w.enabled ? "left-[18px]" : "left-0.5"
                          }`}
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
    </Modal>
  );
}
