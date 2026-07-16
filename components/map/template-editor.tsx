"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileCode2,
  Loader2,
  Sparkles,
} from "lucide-react";
import EditMenu from "./edit-menu";
import ProcessChatEditor from "./process-chat-editor";

const GREETING =
  "Hi! You're editing the new-project template — the set of agents every NEW project starts with. Tell me what you'd like future projects' loops to do differently (change an agent, add a new one, remove one…) and I'll draft it. You'll see exactly what would change before anything is saved. Existing projects are never touched from here.";

type TemplateState = { exists: boolean; files: string[] };

/** The /map/template screen: explainer, template files, and the chat editor. */
export default function TemplateEditor() {
  const [state, setState] = useState<TemplateState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seededUrl, setSeededUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await fetch("/api/map/template");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't read the template.");
      setState({ exists: !!j.exists, files: j.files ?? [] });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't read the template.");
    }
  }, []);

  useEffect(() => {
    // Read the template state (an external system) once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function seed() {
    setSeeding(true);
    setSeedError(null);
    try {
      const res = await fetch("/api/map/template/seed", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't set the template up.");
      setSeededUrl(j.commitUrl ?? null);
      setState({ exists: true, files: j.files ?? [] });
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : "Couldn't set the template up.");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: same Edit menu as the map + a way back */}
      <div className="flex flex-wrap items-center gap-2">
        <EditMenu active="template" />
        <Link
          href="/map"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the map
        </Link>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
        This is what gets installed when you add a new project: every workflow file below is
        copied into the new repo as its starting loop. Edit the template here and every project
        you add <strong className="text-zinc-300">from now on</strong> starts with your version —
        projects that already exist are never changed from this page.
      </p>

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {loadError}
        </div>
      )}

      {state === null && !loadError && (
        <p className="flex items-center gap-2 py-4 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking the template…
        </p>
      )}

      {state !== null && !state.exists && (
        /* Not seeded yet: offer one-tap initialization. */
        <div className="max-w-2xl space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm leading-relaxed text-zinc-300">
            The template hasn&apos;t been set up yet. Tap the button and the current agents from
            your pilot project are copied in as the starting point — after that, everything here
            is yours to edit.
          </p>
          {seedError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {seedError}
            </div>
          )}
          <button
            disabled={seeding}
            onClick={seed}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {seeding ? "Setting up…" : "Initialize template"}
          </button>
        </div>
      )}

      {state !== null && state.exists && (
        <>
          {seededUrl !== null && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Template set up — the pilot&apos;s agents were copied in as one change.{" "}
                {seededUrl && (
                  <a className="underline" href={seededUrl} target="_blank" rel="noreferrer">
                    View it on GitHub
                  </a>
                )}
              </span>
            </div>
          )}

          {/* The files the template currently contains */}
          <div className="flex flex-wrap gap-1.5">
            {state.files.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-400"
              >
                <FileCode2 className="h-3 w-3 text-emerald-400" /> {f}
              </span>
            ))}
          </div>

          <ProcessChatEditor target="template" greeting={GREETING} onApplied={load} />
        </>
      )}
    </div>
  );
}
