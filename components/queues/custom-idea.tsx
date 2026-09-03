"use client";

/**
 * The "Custom idea" composer: the owner drafts an idea for Claude in a
 * CONTINUOUS chat. He writes a starting prompt, then keeps refining the idea's
 * title/body in an ongoing conversation with Claude (which reads the real code
 * and can suggest Claude integrations), while also hand-editing the draft at any
 * time and attaching integrations (MCP servers / skills / plugins) from the
 * catalog. Submitting files the idea as a `proposal` GitHub issue so it enters
 * the normal triage queue.
 *
 * Rendered inside the Ideas page's ToastProvider, so useToast() works here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Mic,
  ExternalLink,
  X,
  RotateCcw,
  Bot,
  User,
  Loader2,
  Send,
  Server,
  Puzzle,
  Plus,
  Wrench,
  Files,
  Search,
} from "lucide-react";
import Modal from "@/components/map/modal";
import CatalogBrowser from "@/components/tools/catalog-browser";
import { useProject } from "@/components/project-context";
import { Spinner, Markdown } from "./ui";
import { useToast } from "./toast";
import { useSpeech } from "./use-speech";
import { useCustomIdeaChat, type AttachedTool, type SuggestedTool } from "./use-custom-idea-chat";

/* ------------------------------------------------------------------ */
/* Duplicate check — types mirroring POST /api/ideas/custom/dedup      */
/* ------------------------------------------------------------------ */

type DuplicateDraftMatch = {
  number: number;
  type: string | null;
  title: string | null;
  score: number;
  htmlUrl: string;
};

type DuplicateDraftResult =
  | {
      available: true;
      matches: DuplicateDraftMatch[];
      duplicate: boolean;
      threshold: number;
      thresholdSource: "metrics" | "builtin";
      model: string;
      indexedDocuments: number;
      indexBuiltAt: string;
      lambdaMs: number;
    }
  | { available: false; reason: string };

/** Least draft worth spending a Bedrock call on. Mirrors the route's MIN_CHARS. */
const DUPLICATE_MIN_CHARS = 20;

/** Small type icon for integration chips (mirrors the catalog's type colors). */
const TYPE_ICON: Record<AttachedTool["type"], { icon: React.ReactNode; chip: string }> = {
  mcp: { icon: <Server className="h-3 w-3" />, chip: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  skill: { icon: <Sparkles className="h-3 w-3" />, chip: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  plugin: { icon: <Puzzle className="h-3 w-3" />, chip: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
};

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
  // The registry comes from the global project switcher — no private fetch,
  // and no project is special-cased here.
  const { projects } = useProject();

  const [projectKey, setProjectKey] = useState<string>(project);
  const [submitting, setSubmitting] = useState(false);
  const [filed, setFiled] = useState<{ number: number; htmlUrl: string } | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const chat = useCustomIdeaChat(projectKey);
  const {
    messages,
    draft,
    attachedTools,
    suggestedTools,
    sending,
    error,
    hasContent,
    sendMessage,
    setDraftTitle,
    setDraftBody,
    attachTool,
    detachTool,
    acceptSuggested,
    dismissSuggested,
    reset,
  } = chat;

  /* ---------------------------------------------------------------- */
  /* Duplicate check                                                   */
  /*                                                                   */
  /* An EXPLICIT action, not a debounce on the textarea. Every check is */
  /* one billable Titan embedding of the draft (the composer's text is  */
  /* not in the index — that is the whole reason it has to be embedded  */
  /* at all). Debouncing a textarea fires every time the owner pauses   */
  /* to think, which on a long draft is dozens of calls to answer a     */
  /* question that is only worth asking once the idea is coherent. A    */
  /* button also makes the result trustworthy: it says "I checked THIS  */
  /* text", not "I checked some earlier version of it".                 */
  /*                                                                    */
  /* Result state lives here rather than in useCustomIdeaChat because   */
  /* it is not part of the draft: persisting it to sessionStorage would */
  /* restore a verdict about text the owner may since have rewritten.   */
  /* ---------------------------------------------------------------- */
  const [dupChecking, setDupChecking] = useState(false);
  const [dupResult, setDupResult] = useState<DuplicateDraftResult | null>(null);
  const [dupCheckedKey, setDupCheckedKey] = useState<string | null>(null);

  // Identity of exactly what would be sent. Re-clicking with an unchanged
  // draft is free: the cached result is reused rather than re-embedded.
  const draftKey = useMemo(
    () => JSON.stringify([projectKey, draft.title.trim(), draft.body.trim()]),
    [projectKey, draft.title, draft.body],
  );
  const dupStale = dupResult !== null && dupCheckedKey !== draftKey;
  const dupCheckable = (draft.title.trim() + draft.body.trim()).length >= DUPLICATE_MIN_CHARS;

  async function checkDuplicates() {
    if (dupChecking || !dupCheckable) return;
    // Already answered for this exact text — reuse it rather than pay for a
    // second identical embedding. A FAILED check is not an answer, so a
    // timeout or a transient 5xx stays retryable.
    if (dupResult?.available && dupCheckedKey === draftKey) return;
    const key = draftKey;
    setDupChecking(true);
    try {
      const res = await fetch("/api/ideas/custom/dedup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectKey,
          title: draft.title,
          body: draft.body,
        }),
      });
      const data = (await res.json().catch(() => null)) as DuplicateDraftResult | null;
      setDupResult(
        data ?? { available: false, reason: "The duplicate check couldn't run just now." },
      );
      setDupCheckedKey(key);
    } catch {
      // Never a toast.error: this is decoration on a draft, and a failed check
      // must not read like a failed action.
      setDupResult({ available: false, reason: "Couldn't reach the duplicate check." });
      setDupCheckedKey(key);
    } finally {
      setDupChecking(false);
    }
  }

  const isCurrentProject = projectKey === project;
  const projectLabel = useMemo(
    () => projects.find((p) => p.key === projectKey)?.label ?? projectKey,
    [projects, projectKey],
  );

  function clearDraft() {
    speech.stop();
    reset();
    setDupResult(null);
    setDupCheckedKey(null);
  }

  function closeAll() {
    speech.stop();
    onClose();
  }

  async function submit() {
    if (!draft.body.trim()) {
      toast.error("Draft your idea before submitting.");
      return;
    }
    speech.stop();
    setSubmitting(true);
    try {
      const res = await fetch("/api/ideas/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectKey,
          title: draft.title.trim() || undefined,
          body: draft.body,
          attachedTools: attachedTools.map((t) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            url: t.url,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't file the idea. Try again.");

      reset(); // it's filed now — clear the saved draft
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
      setSubmitting(false);
    }
  }

  const busy = submitting || sending;

  return (
    <Modal onClose={closeAll} className="max-w-4xl">
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
                onChange={(e) => setProjectKey(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
              >
                {/* If the registry hasn't loaded, still show the project the
                    page is scoped to rather than an empty selector. */}
                {!projects.some((p) => p.key === projectKey) && (
                  <option value={projectKey}>{projectLabel}</option>
                )}
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Two-part layout: draft (left) + chat (right) */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* (a) The draft — hand-editable at any time */}
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">Title</label>
                  <input
                    value={draft.title}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    disabled={submitting}
                    placeholder="Give the idea a short title…"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    Idea (Markdown)
                  </label>
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraftBody(e.target.value)}
                    rows={14}
                    disabled={submitting}
                    placeholder="Your idea takes shape here. Chat with Claude to refine it, or write it yourself…"
                    className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
                  />
                </div>
                {draft.body.trim() && (
                  <details className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <summary className="cursor-pointer text-xs font-medium text-zinc-400">
                      Preview
                    </summary>
                    <div className="mt-2">
                      <Markdown>{draft.body}</Markdown>
                    </div>
                  </details>
                )}

                <DuplicateCheck
                  checking={dupChecking}
                  result={dupResult}
                  stale={dupStale}
                  checkable={dupCheckable}
                  disabled={submitting}
                  onCheck={() => void checkDuplicates()}
                />
              </div>

              {/* (b) The chat — keeps refining the draft */}
              <ChatPanel
                messages={messages}
                sending={sending}
                error={error}
                onSend={(t) => void sendMessage(t)}
                speech={speech}
              />
            </div>

            {/* Integrations row */}
            <Integrations
              attached={attachedTools}
              suggested={suggestedTools}
              onDetach={detachTool}
              onAccept={acceptSuggested}
              onDismiss={dismissSuggested}
              onBrowse={() => setShowCatalog(true)}
              disabled={submitting}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      {!filed && (
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-zinc-600 sm:inline">
              Files as a proposal on {isCurrentProject ? "this project" : projectLabel} for triage.
            </span>
            {hasContent && (
              <button
                onClick={clearDraft}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Start over
              </button>
            )}
          </div>
          <button
            onClick={submit}
            disabled={busy || !draft.body.trim()}
            title={sending ? "Wait for Claude to finish…" : undefined}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? <Spinner /> : null}
            Submit idea
          </button>
        </div>
      )}

      {/* Catalog picker (multi-select) */}
      {showCatalog && (
        <Modal onClose={() => setShowCatalog(false)} className="max-w-3xl">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-emerald-400" />
              <h2 className="text-base font-semibold text-zinc-100">Attach integrations</h2>
            </div>
            <button
              onClick={() => setShowCatalog(false)}
              className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <CatalogBrowser
              selectable
              selectedIds={attachedTools.map((t) => t.id)}
              onToggleSelect={(entry) =>
                attachedTools.some((t) => t.id === entry.id)
                  ? detachTool(entry.id)
                  : attachTool(entry)
              }
            />
          </div>
          <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
            <span className="text-xs text-zinc-500">
              {attachedTools.length} attached
            </span>
            <button
              onClick={() => setShowCatalog(false)}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Done
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Duplicate check panel                                               */
/* ------------------------------------------------------------------ */

/**
 * "Has this already been proposed?" for the draft, before it is filed.
 *
 * This is the one surface in the product that calls the deployed inference
 * Lambda (`infra/lambda-dedup-infer/`, via `POST /api/ideas/custom/dedup`).
 * The Ideas screen scores its cards locally because their vectors already
 * exist; a draft has no vector, so it has to be embedded, and that is exactly
 * what the service is for.
 *
 * It never blocks anything. Every failure — unconfigured, no credentials,
 * timeout, 403 — renders as one grey line of explanation next to a Submit
 * button that stays enabled.
 */
function DuplicateCheck({
  checking,
  result,
  stale,
  checkable,
  disabled,
  onCheck,
}: {
  checking: boolean;
  result: DuplicateDraftResult | null;
  /** The draft changed since this result was produced. */
  stale: boolean;
  /** Enough text to be worth a billable embedding call. */
  checkable: boolean;
  disabled?: boolean;
  onCheck: () => void;
}) {
  const hits = result?.available ? result.matches : [];
  // Only matches at or above the calibrated operating point are shown. The
  // Lambda returns the top K regardless of score, and a 0.41 "match" presented
  // as a possible duplicate is exactly the kind of unexplainable result that
  // teaches an owner to ignore the feature.
  const flagged = result?.available ? hits.filter((m) => m.score >= result.threshold) : [];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Already proposed?
        </p>
        <button
          onClick={onCheck}
          disabled={disabled || checking || !checkable || (!!result?.available && !stale)}
          title={
            !checkable
              ? "Write a bit more of the idea first."
              : result?.available && !stale
                ? "This exact draft has already been checked."
                : "Embeds the draft and scores it against the backlog."
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          {checking
            ? "Checking…"
            : stale
              ? "Check again"
              : result && !result.available
                ? "Try again"
                : "Check for duplicates"}
        </button>
      </div>

      {!result && !checking && (
        <p className="mt-2 text-xs text-zinc-500">
          Checks this draft against the backlog before you file it.
        </p>
      )}

      {result && !result.available && (
        <p className="mt-2 text-xs text-zinc-500">{result.reason}</p>
      )}

      {result?.available && (
        <div className="mt-2">
          {stale && (
            <p className="mb-2 text-[11px] text-amber-300">
              You&apos;ve edited the draft since this check — run it again.
            </p>
          )}

          {flagged.length === 0 ? (
            <p className="text-xs text-zinc-400">
              Nothing in the backlog scores at or above {result.threshold}. Closest was{" "}
              {hits[0] ? `#${hits[0].number} at ${hits[0].score.toFixed(3)}` : "nothing"}.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <Files className="h-3.5 w-3.5 text-violet-300" />
                <span className="text-xs font-semibold text-violet-300">
                  {flagged.length === 1
                    ? "This looks like an existing item"
                    : "This looks like existing items"}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {flagged.map((m) => (
                  <li key={m.number}>
                    <a
                      href={m.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-start gap-2 rounded-lg -mx-1.5 px-1.5 py-1 transition hover:bg-violet-500/10"
                    >
                      <span className="shrink-0 pt-px text-xs tabular-nums text-zinc-500 group-hover:text-violet-300">
                        #{m.number}
                      </span>
                      <span className="min-w-0 flex-1 text-sm leading-snug text-zinc-300 group-hover:text-zinc-100">
                        {m.title ?? "(no title in the corpus)"}
                      </span>
                      <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium tabular-nums text-violet-200">
                        {m.score.toFixed(3)}
                      </span>
                      <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-zinc-600 group-hover:text-violet-300" />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* The provenance line. "0.86" means nothing without the encoder, the
              operating point, and where that operating point came from — and an
              unexplained number is the kind that gets "fixed" by the next
              person to read it. */}
          <p
            className="mt-2 text-[11px] leading-relaxed text-zinc-600"
            title={
              `Cosine similarity between Titan v2 embeddings of your draft and each of the ` +
              `${result.indexedDocuments} indexed issues and pull requests. Anything at or above ` +
              `${result.threshold} is flagged — the precision-first operating point swept on a ` +
              `150-pair labelled set (${
                result.thresholdSource === "metrics"
                  ? "read from metrics/dedup-eval.json"
                  : "built-in fallback; metrics/dedup-eval.json was unreadable"
              }), where it measured precision 0.909 and recall 0.800. It was tuned on the data it ` +
              `was scored on, so treat those as optimistic.`
            }
          >
            Titan v2 · {result.indexedDocuments} indexed documents · flagged at ≥{" "}
            {result.threshold} · {result.lambdaMs} ms
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chat panel — mirrors components/queues/idea-chat.tsx styling         */
/* ------------------------------------------------------------------ */

function ChatPanel({
  messages,
  sending,
  error,
  onSend,
  speech,
}: {
  messages: { role: "user" | "assistant"; content: string }[];
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  speech: ReturnType<typeof useSpeech>;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  function submit() {
    if (!input.trim() || sending) return;
    const text = input;
    setInput("");
    speech.stop();
    onSend(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const listening = speech.listeningTarget === "custom-chat";
  const started = messages.length > 0;

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
          <Bot className="h-3.5 w-3.5" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Draft with Claude
        </p>
      </div>

      <div
        ref={scrollRef}
        className="mb-3 min-h-[10rem] flex-1 space-y-3 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
      >
        {!started && !sending && (
          <p className="text-sm text-zinc-500">
            Describe what you want Claude to look into or build. It reads the real code, refines the
            draft on the left, and can suggest integrations.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                m.role === "user" ? "bg-zinc-800 text-zinc-400" : "bg-emerald-500/10 text-emerald-400"
              }`}
            >
              {m.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            </span>
            <div className="min-w-0 flex-1 text-sm text-zinc-200">
              <Markdown>{m.content}</Markdown>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Claude is thinking…
          </div>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              started
                ? "Keep refining — ask Claude to adjust the draft…"
                : "Describe what you want Claude to look into or build…"
            }
            rows={2}
            className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-11 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
          />
          <button
            type="button"
            onClick={() =>
              speech.toggle("custom-chat", (t) =>
                setInput((cur) => (cur ? `${cur} ${t}` : t)),
              )
            }
            disabled={!speech.supported}
            title={
              speech.supported
                ? listening
                  ? "Stop dictating"
                  : "Dictate with your voice"
                : "Voice input isn't supported in this browser — Chrome and Safari work."
            }
            aria-label="Dictate with your voice"
            className={`absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40 ${
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
              <Mic className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <button
          onClick={submit}
          disabled={sending || !input.trim()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      {listening && speech.interim && (
        <p className="mt-1 px-1 text-sm italic text-zinc-500">{speech.interim}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Integrations row — attached chips + suggestions + browse            */
/* ------------------------------------------------------------------ */

function Integrations({
  attached,
  suggested,
  onDetach,
  onAccept,
  onDismiss,
  onBrowse,
  disabled,
}: {
  attached: AttachedTool[];
  suggested: SuggestedTool[];
  onDetach: (id: string) => void;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onBrowse: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Integrations</p>
        <button
          onClick={onBrowse}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
        >
          <Wrench className="h-3.5 w-3.5" /> Browse catalog
        </button>
      </div>

      {attached.length === 0 ? (
        <p className="text-xs text-zinc-500">
          None attached yet. Browse the catalog or add one Claude suggests below.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {attached.map((t) => {
            const meta = TYPE_ICON[t.type];
            return (
              <span
                key={t.id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.chip}`}
              >
                {meta.icon}
                {t.name}
                <button
                  onClick={() => onDetach(t.id)}
                  disabled={disabled}
                  aria-label={`Remove ${t.name}`}
                  className="ml-0.5 rounded-full p-0.5 transition hover:bg-black/20 disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {suggested.length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <p className="mb-1.5 text-[11px] font-medium text-zinc-500">Claude suggests</p>
          <div className="flex flex-col gap-1.5">
            {suggested.map((t) => {
              const meta = TYPE_ICON[t.type];
              return (
                <div
                  key={t.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.chip}`}>
                        {meta.icon} {t.type}
                      </span>
                      <span className="truncate text-xs font-semibold text-zinc-200">{t.name}</span>
                      {t.url && (
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-500 hover:text-emerald-400"
                          aria-label={`Open ${t.name}`}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {t.reason && <p className="mt-1 text-[11px] text-zinc-400">{t.reason}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => onAccept(t.id)}
                      disabled={disabled}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-700 bg-emerald-950/40 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-900/40 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" /> Add
                    </button>
                    <button
                      onClick={() => onDismiss(t.id)}
                      disabled={disabled}
                      className="rounded-lg px-2 py-1 text-[11px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filed success                                                       */
/* ------------------------------------------------------------------ */

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
