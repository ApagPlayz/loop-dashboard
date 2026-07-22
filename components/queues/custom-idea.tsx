"use client";

/**
 * The "Custom idea" composer: the owner writes his own idea/research prompt for
 * Claude, optionally with voice dictation, optionally letting Claude ask a few
 * clarifying questions before it writes the idea up. Submitting files the idea
 * as a `proposal` GitHub issue so it enters the normal triage queue.
 *
 * Rendered inside the Ideas page's ToastProvider, so useToast() works here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Mic, ExternalLink, X, RotateCcw, ArrowLeft } from "lucide-react";
import Modal from "@/components/map/modal";
import { Spinner, Markdown } from "./ui";
import { useToast } from "./toast";
import { useSpeech } from "./use-speech";

const PILOT_KEY = "content-generation-platform";
const DRAFT_STORAGE_KEY = "customIdea:v1";
const POLL_MS = 2500;

type Project = { key: string; label: string; owner: string; repo: string };
type Stage = "write" | "questions" | "review";
type BusyKind = "clarify" | "compose" | "submit" | null;

type Draft = {
  projectKey: string;
  prompt: string;
  stage: Stage;
  questions: string[];
  answers: string[];
  draftTitle: string;
  draftBody: string;
};

const EMPTY_DRAFT: Draft = {
  projectKey: PILOT_KEY,
  prompt: "",
  stage: "write",
  questions: [],
  answers: [],
  draftTitle: "",
  draftBody: "",
};

/** POST the AI route; returns the background job's id. */
async function startAiJob(body: unknown): Promise<string> {
  const res = await fetch("/api/ideas/custom/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const started = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(started.error ?? "Couldn't start. Try again.");
  return started.jobId as string;
}

/**
 * Poll the shared job endpoint until the job settles. Returns null when the
 * caller reports it no longer cares (the modal closed) — the job itself keeps
 * running server-side and is restored the next time the modal opens.
 */
async function pollAiJob<T>(jobId: string, cancelled?: () => boolean): Promise<T | null> {
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (cancelled?.()) return null;
    let r: Response;
    try {
      r = await fetch(`/api/map/ai-job/${jobId}`);
    } catch {
      continue; // transient network blip — keep polling
    }
    if (r.status === 404) throw new Error("That request expired. Try again.");
    const jj = await r.json().catch(() => ({}));
    const job = jj.job;
    if (!job) continue;
    if (job.status === "done") return job.result as T;
    if (job.status === "error") throw new Error(job.error ?? "Something went wrong. Try again.");
  }
}

/** Tell the server the result was applied (best-effort). */
function consumeAiJob(jobId: string) {
  fetch(`/api/map/ai-job/${jobId}`, { method: "POST" }).catch(() => {});
}

export default function CustomIdea({
  onClose,
  onRefreshPilot,
  project,
}: {
  onClose: () => void;
  onRefreshPilot: () => void;
  /** The project currently selected on the Ideas page — the default target. */
  project: string;
}) {
  const toast = useToast();
  const speech = useSpeech();

  const [projects, setProjects] = useState<Project[]>([]);
  // Lazily restore any in-progress draft from sessionStorage. The modal only
  // mounts after a click (never server-rendered while open), so reading storage
  // during init is safe and avoids a restore/persist race. A brand-new draft
  // defaults to whichever project is currently selected on the Ideas page.
  const [draft, setDraft] = useState<Draft>(() => {
    if (typeof window === "undefined") return { ...EMPTY_DRAFT, projectKey: project };
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        return { ...EMPTY_DRAFT, projectKey: project, ...(JSON.parse(raw) as Partial<Draft>) };
      }
    } catch {
      /* ignore */
    }
    return { ...EMPTY_DRAFT, projectKey: project };
  });
  const [busy, setBusy] = useState<BusyKind>(null);
  const [elapsed, setElapsed] = useState(0);
  const [filed, setFiled] = useState<{ number: number; htmlUrl: string } | null>(null);

  const { projectKey, prompt, stage, questions, answers, draftTitle, draftBody } = draft;

  const patch = useCallback((p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p })), []);

  // Closing the modal must stop our polling loops WITHOUT consuming the job —
  // it keeps running server-side and is picked back up on the next open.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Fold a finished clarify/compose job into the draft (persisted above). */
  const applyJobResult = useCallback(
    (mode: "clarify" | "compose", result: unknown) => {
      if (mode === "clarify") {
        const qs = (result as { questions?: string[] } | undefined)?.questions ?? [];
        patch({ stage: "questions", questions: qs, answers: qs.map(() => "") });
      } else {
        const r = result as { title?: string; body?: string } | undefined;
        patch({ stage: "review", draftTitle: r?.title ?? "", draftBody: r?.body ?? "" });
      }
    },
    [patch],
  );

  // On open: re-attach to a clarify/compose job the owner walked away from.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ kind: "custom-idea" });
        // draft.projectKey was restored from sessionStorage during state init.
        params.set("project", projectKey);
        const res = await fetch(`/api/map/ai-job/latest?${params}`);
        const j = await res.json().catch(() => ({}));
        if (cancelled || !j.job) return;
        const job = j.job as {
          id: string;
          status: "running" | "done" | "error";
          input?: { mode?: string };
          result?: unknown;
          error?: string;
        };
        const mode = job.input?.mode === "compose" ? "compose" : "clarify";
        if (job.status === "done") {
          applyJobResult(mode, job.result);
          consumeAiJob(job.id);
          return;
        }
        if (job.status === "error") {
          toast.error(job.error ?? "Something went wrong. Try again.");
          consumeAiJob(job.id);
          return;
        }
        // Still running — show the spinner and keep waiting for it.
        setElapsed(0);
        setBusy(mode);
        try {
          const result = await pollAiJob<unknown>(job.id, () => !mountedRef.current);
          if (result === null || cancelled) return;
          applyJobResult(mode, result);
          consumeAiJob(job.id);
        } catch (err) {
          if (!cancelled && mountedRef.current) {
            toast.error(err instanceof Error ? err.message : "Something went wrong. Try again.");
          }
        } finally {
          if (!cancelled && mountedRef.current) setBusy(null);
        }
      } catch {
        // Nothing to restore — not fatal.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- persist the draft as it changes ------------------------------
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft]);

  // ----- load the project list ----------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/map/projects");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data.projects)) {
          setProjects(data.projects as Project[]);
        }
      } catch {
        /* the selector just falls back to the pilot */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- elapsed-seconds ticker while a job runs ----------------------
  // elapsed is reset to 0 in the handlers when a job starts; here we just tick.
  useEffect(() => {
    if (busy !== "clarify" && busy !== "compose") return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Whether the idea is being filed on the same project currently shown on
  // the Ideas page — if so, filing can just refresh that list and close.
  const isCurrentProject = projectKey === project;
  const projectLabel = useMemo(
    () => projects.find((p) => p.key === projectKey)?.label ?? "the selected project",
    [projects, projectKey],
  );

  function clearDraft() {
    speech.stop();
    setDraft(EMPTY_DRAFT);
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function closeAll() {
    speech.stop();
    onClose();
  }

  // ----- actions ------------------------------------------------------
  async function askClarifying() {
    if (!prompt.trim()) {
      toast.error("Write your idea first, then Claude can ask about it.");
      return;
    }
    speech.stop();
    setElapsed(0);
    setBusy("clarify");
    try {
      const jobId = await startAiJob({
        mode: "clarify",
        project: projectKey,
        prompt: prompt.trim(),
      });
      const result = await pollAiJob<{ questions: string[] }>(jobId, () => !mountedRef.current);
      if (result === null) return; // modal closed — restored on next open
      applyJobResult("clarify", result);
      consumeAiJob(jobId);
    } catch (err) {
      if (!mountedRef.current) return;
      toast.error(err instanceof Error ? err.message : "Couldn't get questions. Try again.");
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  async function compose() {
    speech.stop();
    setElapsed(0);
    setBusy("compose");
    try {
      const jobId = await startAiJob({
        mode: "compose",
        project: projectKey,
        prompt: prompt.trim(),
        questions,
        answers,
      });
      const result = await pollAiJob<{ title: string; body: string }>(
        jobId,
        () => !mountedRef.current,
      );
      if (result === null) return; // modal closed — restored on next open
      applyJobResult("compose", result);
      consumeAiJob(jobId);
    } catch (err) {
      if (!mountedRef.current) return;
      toast.error(err instanceof Error ? err.message : "Couldn't write it up. Try again.");
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  async function submit(opts: { body: string; title?: string; viaClarify: boolean }) {
    if (!opts.body.trim()) {
      toast.error("Write your idea before submitting.");
      return;
    }
    speech.stop();
    setBusy("submit");
    try {
      const res = await fetch("/api/ideas/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectKey,
          title: opts.title,
          body: opts.body,
          viaClarify: opts.viaClarify,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't file the idea. Try again.");

      // Clear the saved draft — it's filed now.
      try {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        /* ignore */
      }

      if (isCurrentProject) {
        toast.success("Idea filed — it's now in the queue.");
        onRefreshPilot();
        closeAll();
      } else {
        toast.success("Idea filed.");
        setFiled({ number: data.number, htmlUrl: data.htmlUrl });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't file the idea. Try again.");
    } finally {
      setBusy(null);
    }
  }

  // ----- render -------------------------------------------------------
  const running = busy === "clarify" || busy === "compose";
  const hasContent = prompt.trim() || draftBody.trim() || questions.length > 0;

  return (
    <Modal onClose={closeAll} className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-emerald-400" />
          <h2 className="text-base font-semibold text-zinc-100">Custom idea</h2>
        </div>
        <button
          onClick={closeAll}
          className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {filed ? (
          <FiledSuccess filed={filed} onClose={closeAll} />
        ) : (
          <div className="space-y-4">
            {/* Project selector */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Which project is this for?
              </label>
              <select
                value={projectKey}
                onChange={(e) => patch({ projectKey: e.target.value })}
                disabled={running || busy === "submit"}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
              >
                {projects.length === 0 && (
                  <option value={projectKey}>
                    {projectKey === PILOT_KEY ? "Content Generation Platform" : projectKey}
                  </option>
                )}
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Stage: write */}
            {stage === "write" && (
              <>
                <Field
                  label="Your idea"
                  targetId="prompt"
                  value={prompt}
                  onChange={(v) => patch({ prompt: v })}
                  onAppend={(t) => patch({ prompt: prompt ? `${prompt} ${t}` : t })}
                  placeholder="Describe what you want Claude to look into or build…"
                  rows={6}
                  speech={speech}
                  disabled={running || busy === "submit"}
                />

                {running && <RunningNote label={busy === "clarify" ? "Claude is reading your idea…" : "Claude is writing it up…"} elapsed={elapsed} />}

                {!running && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      onClick={askClarifying}
                      disabled={busy !== null || !prompt.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950/30 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-900/30 disabled:opacity-50"
                    >
                      Ask clarifying questions
                    </button>
                    <button
                      onClick={() => submit({ body: prompt.trim(), viaClarify: false })}
                      disabled={busy !== null || !prompt.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {busy === "submit" ? <Spinner /> : null}
                      Submit as is
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Stage: questions */}
            {stage === "questions" && (
              <>
                <p className="text-sm text-zinc-400">
                  Answer what you can — leave any blank to skip. Then Claude will write up your idea.
                </p>
                {questions.map((q, i) => (
                  <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-200">
                        {i + 1}. {q}
                      </p>
                      {answers[i]?.trim() ? (
                        <button
                          onClick={() => {
                            const next = [...answers];
                            next[i] = "";
                            patch({ answers: next });
                          }}
                          className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
                        >
                          Skip
                        </button>
                      ) : null}
                    </div>
                    <Field
                      targetId={`answer-${i}`}
                      value={answers[i] ?? ""}
                      onChange={(v) => {
                        const next = [...answers];
                        next[i] = v;
                        patch({ answers: next });
                      }}
                      onAppend={(t) => {
                        const next = [...answers];
                        const cur = next[i] ?? "";
                        next[i] = cur ? `${cur} ${t}` : t;
                        patch({ answers: next });
                      }}
                      placeholder="Your answer (optional)…"
                      rows={2}
                      speech={speech}
                      disabled={running || busy === "submit"}
                    />
                  </div>
                ))}

                {running && <RunningNote label="Claude is writing it up…" elapsed={elapsed} />}

                {!running && (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => patch({ stage: "write" })}
                      className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
                    >
                      <ArrowLeft className="h-4 w-4" /> Back
                    </button>
                    <button
                      onClick={compose}
                      disabled={busy !== null}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Compose my idea
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Stage: review */}
            {stage === "review" && (
              <>
                <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
                  Review and edit before submitting.
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">Title</label>
                  <input
                    value={draftTitle}
                    onChange={(e) => patch({ draftTitle: e.target.value })}
                    disabled={busy === "submit"}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    Idea (Markdown)
                  </label>
                  <textarea
                    value={draftBody}
                    onChange={(e) => patch({ draftBody: e.target.value })}
                    rows={12}
                    disabled={busy === "submit"}
                    className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
                  />
                </div>
                {draftBody.trim() && (
                  <details className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <summary className="cursor-pointer text-xs font-medium text-zinc-400">
                      Preview
                    </summary>
                    <div className="mt-2">
                      <Markdown>{draftBody}</Markdown>
                    </div>
                  </details>
                )}
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => patch({ stage: "questions" })}
                    className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() =>
                      submit({ body: draftBody, title: draftTitle.trim() || undefined, viaClarify: true })
                    }
                    disabled={busy !== null || !draftBody.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {busy === "submit" ? <Spinner /> : null}
                    Submit idea
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {!filed && (
        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <span className="text-xs text-zinc-600">
            Files as a proposal on {isCurrentProject ? "this project" : projectLabel} for triage.
          </span>
          {hasContent && (
            <button
              onClick={clearDraft}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Start over
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Field({
  label,
  targetId,
  value,
  onChange,
  onAppend,
  placeholder,
  rows,
  speech,
  disabled,
}: {
  label?: string;
  targetId: string;
  value: string;
  onChange: (v: string) => void;
  onAppend: (text: string) => void;
  placeholder: string;
  rows: number;
  speech: ReturnType<typeof useSpeech>;
  disabled?: boolean;
}) {
  const listening = speech.listeningTarget === targetId;
  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</label>
      )}
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 pr-12 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
        />
        <MicButton targetId={targetId} onAppend={onAppend} speech={speech} disabled={disabled} />
      </div>
      {listening && speech.interim && (
        <p className="mt-1 px-1 text-sm italic text-zinc-500">{speech.interim}</p>
      )}
      {listening && !speech.interim && (
        <p className="mt-1 px-1 text-xs text-zinc-500">Listening… speak now.</p>
      )}
      {speech.error && speech.listeningTarget === null && (
        <p className="mt-1 px-1 text-xs text-amber-300">{speech.error}</p>
      )}
    </div>
  );
}

function MicButton({
  targetId,
  onAppend,
  speech,
  disabled,
}: {
  targetId: string;
  onAppend: (text: string) => void;
  speech: ReturnType<typeof useSpeech>;
  disabled?: boolean;
}) {
  const listening = speech.listeningTarget === targetId;
  const title = speech.supported
    ? listening
      ? "Stop dictating"
      : "Dictate with your voice"
    : "Voice input isn't supported in this browser — Chrome and Safari work.";
  return (
    <button
      type="button"
      onClick={() => speech.toggle(targetId, onAppend)}
      disabled={disabled || !speech.supported}
      title={title}
      aria-label={title}
      className={`absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40 ${
        listening
          ? "border-red-700 bg-red-950/50 text-red-300"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      {listening ? (
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}

function RunningNote({ label, elapsed }: { label: string; elapsed: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3">
      <div className="flex items-center gap-2 text-sm text-zinc-300">
        <Spinner />
        <span>{label}</span>
        <span className="text-zinc-500 tabular-nums">{elapsed}s</span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        Keeps running if you close this or leave the page — it picks up where it left off.
      </p>
    </div>
  );
}

function FiledSuccess({
  filed,
  onClose,
}: {
  filed: { number: number; htmlUrl: string };
  onClose: () => void;
}) {
  return (
    <div className="space-y-4 py-4 text-center">
      <p className="text-sm text-zinc-200">
        Your idea was filed as proposal #{filed.number}. It will not show in the list here (that
        only shows the project you&apos;re currently viewing), but it is queued for triage on its
        project.
      </p>
      <a
        href={filed.htmlUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
      >
        Open the idea on GitHub <ExternalLink className="h-4 w-4" />
      </a>
      <div>
        <button
          onClick={onClose}
          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
        >
          Done
        </button>
      </div>
    </div>
  );
}
