"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileCode2,
  FileText,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import EditMenu from "./edit-menu";
import Modal from "./modal";
import ProcessChatEditor from "./process-chat-editor";

const GREETING =
  "Hi! You're editing the new-project template — the set of agents every NEW project starts with. Tell me what you'd like future projects' loops to do differently (change an agent, add a new one, remove one…) and I'll draft it. You'll see exactly what would change before anything is saved. Existing projects are never touched from here.";

/**
 * One non-workflow baseline file, with where it lands in a new project.
 *
 * `hash` is the version the server handed us. It goes back with a save so a
 * change someone else made in the meantime is refused rather than overwritten.
 */
type TemplateAsset = {
  file: string;
  target: string | null;
  content: string;
  hash?: string;
};

type TemplateState = { exists: boolean; workflows: string[]; files: TemplateAsset[] };

/** The /map/template screen: explainer, template files, and the chat editor. */
export default function TemplateEditor() {
  const [state, setState] = useState<TemplateState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seededUrl, setSeededUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<TemplateAsset | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await fetch("/api/map/template");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't read the template.");
      setState({ exists: !!j.exists, workflows: j.workflows ?? [], files: j.files ?? [] });
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
      await load();
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
        This is what gets installed when you add a new project: every file below — the agents
        and the starting files they work from — is copied into the new repo as its starting
        loop. Edit the template here and every project
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

          {/* The agents the template currently contains */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-zinc-300">Agents</p>
            <div className="flex flex-wrap gap-1.5">
              {state.workflows.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-400"
                >
                  <FileCode2 className="h-3 w-3 text-emerald-400" /> {f}
                </span>
              ))}
            </div>
          </div>

          {/* The other starting files (briefs, contracts, settings) */}
          {state.files.length > 0 && (
            <div className="max-w-2xl">
              <p className="mb-1 text-xs font-semibold text-zinc-300">Starting files</p>
              <p className="mb-2 text-xs leading-relaxed text-zinc-500">
                Not agents — the other files every new project starts with (its brief, the rules
                the agents follow, its settings). Tap one to read or edit it.
              </p>
              <div className="space-y-1.5">
                {state.files.map((f) => (
                  <button
                    key={f.file}
                    onClick={() => setEditing(f)}
                    className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left transition hover:bg-zinc-800"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <span className="font-mono text-[11px] text-zinc-300">{f.file}</span>
                    {f.target && (
                      <span className="ml-auto truncate font-mono text-[10px] text-zinc-600">
                        goes to {f.target}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ProcessChatEditor target="template" greeting={GREETING} onApplied={load} />
        </>
      )}

      {editing && (
        <TemplateFileEditor asset={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}

/**
 * Read/edit one starting file, in the same centered modal the map uses.
 * Saving commits that single file to the template as one change.
 */
function TemplateFileEditor({
  asset,
  onClose,
  onSaved,
}: {
  asset: TemplateAsset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(asset.content);
  /** What's currently in the template — moves forward on every save. */
  const [baseline, setBaseline] = useState(asset.content);
  /** The stored version this edit is based on; moves forward with `baseline`. */
  const [baseHash, setBaseHash] = useState(asset.hash);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the file moved on under us — the only fix is to reopen it. */
  const [stale, setStale] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const dirty = text !== baseline;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/map/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: asset.file,
          section: "files",
          newContent: text,
          summary: `edit ${asset.file}`,
          // Base-version check: the server refuses the save (409) rather than
          // overwriting a change made since this editor was opened.
          expectedHash: baseHash,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setStale(true);
        throw new Error(
          j.error ?? "This file changed since you opened it — reopen to get the latest.",
        );
      }
      if (!res.ok) throw new Error(j.error ?? "Couldn't save the file.");
      setSavedUrl(j.commitUrl ?? "");
      setBaseline(text);
      setBaseHash(j.hash);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the file.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      className="h-[95vh] w-[95vw] sm:h-auto sm:max-h-[85vh] sm:w-[90vw] sm:max-w-[820px]"
    >
      <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-3">
        <div className="leading-tight">
          <h2 className="font-mono text-sm font-semibold text-zinc-100">{asset.file}</h2>
          <p className="text-[11px] text-zinc-500">
            {asset.target
              ? `Copied into every new project as ${asset.target}`
              : "Part of every new project"}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSavedUrl(null);
          }}
          spellCheck={false}
          className="h-[52vh] min-h-[240px] w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-200 focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Changes here only affect projects you add <strong className="text-zinc-400">from
          now on</strong> — projects that already exist are never changed from this page.
        </p>

        {error && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
              stale
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-red-500/30 bg-red-500/10 text-red-200"
            }`}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {error}
              {stale && (
                <>
                  {" "}
                  Nothing was saved. Copy anything you want to keep, then{" "}
                  <button
                    type="button"
                    onClick={() => {
                      onSaved();
                      onClose();
                    }}
                    className="underline underline-offset-2"
                  >
                    reopen the file
                  </button>
                  .
                </>
              )}
            </span>
          </div>
        )}
        {savedUrl !== null && !dirty && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Saved.{" "}
              {savedUrl && (
                <a className="underline" href={savedUrl} target="_blank" rel="noreferrer">
                  View it on GitHub
                </a>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
        >
          Close
        </button>
        <button
          disabled={saving || stale || !dirty || text.trim() === ""}
          onClick={save}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
