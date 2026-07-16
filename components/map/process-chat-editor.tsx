"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  Send,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import type { FileChange } from "@/lib/map-types";
import { AGENTS } from "@/lib/map-agents";
import { InlineDiff } from "./diff";
import { useAiJob, formatElapsed } from "./use-ai-job";

/**
 * Conversational process editor (chat with Claude about the loop's workflow
 * files, review drafted changes as diffs, apply with one tap).
 *
 * Reusable for two targets:
 *   - target="template"      → the new-project template (may add/remove files)
 *   - target=<project key>   → that project's live workflows (modify only)
 *
 * Each send runs as a background job (the AI is slow) via the map-ai-jobs
 * pattern, so the owner can leave the page mid-draft and come back. The
 * conversation itself is kept per target in sessionStorage.
 */

type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  /** Drafted file changes attached to an assistant reply. */
  changes?: FileChange[];
  /** Set once the changes were committed — link to the commit. */
  appliedUrl?: string;
};

function storageKey(target: string): string {
  return `loop-dash-process-chat.${target}`;
}

function loadHistory(target: string, greeting: ChatMsg): ChatMsg[] {
  try {
    const raw = window.sessionStorage.getItem(storageKey(target));
    if (!raw) return [greeting];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as ChatMsg[];
  } catch {
    /* ignore corrupt storage */
  }
  return [greeting];
}

function fileLabel(file: string): string {
  return AGENTS.find((a) => a.file === file)?.label ?? file;
}

export default function ProcessChatEditor({
  target,
  greeting,
  onApplied,
}: {
  /** "template" or a project registry key. */
  target: string;
  /** Plain-English first assistant message explaining what this chat edits. */
  greeting: string;
  /** Called after changes were committed (e.g. to refresh a file list). */
  onApplied?: () => void;
}) {
  const greetingMsg: ChatMsg = { role: "assistant", content: greeting };
  const [messages, setMessages] = useState<ChatMsg[]>([greetingMsg]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const handledJobId = useRef<string | null>(null);

  // Background drafting job: submit, poll, restore across page visits.
  const { job, submitting, submitError, elapsedSec, start, consume } = useAiJob({
    kind: "process-chat",
    project: target,
  });

  // Restore the conversation once on the client.
  useEffect(() => {
    // Reading sessionStorage (an external store) once per target.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(loadHistory(target, { role: "assistant", content: greeting }));
    setHydrated(true);
  }, [target, greeting]);

  // Persist the conversation.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(storageKey(target), JSON.stringify(messages));
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [messages, hydrated, target]);

  // When a drafting job finishes, fold its reply into the transcript.
  useEffect(() => {
    if (!hydrated || !job || job.status !== "done" || handledJobId.current === job.id) return;
    handledJobId.current = job.id;
    const result = job.result as { reply?: string; changes?: FileChange[] } | undefined;
    const reply = (result?.reply ?? "").trim();
    if (reply) {
      // Folding a finished background job (an external system) into the transcript.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply,
          changes: result?.changes && result.changes.length > 0 ? result.changes : undefined,
        },
      ]);
    }
    consume();
  }, [job, hydrated, consume]);

  // Keep the transcript scrolled to the newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, job?.status]);

  const running = submitting || job?.status === "running";
  const jobError = job?.status === "error" ? (job.error ?? "Something went wrong.") : null;

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || running) return;
    setApplyError(null);
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    start("/api/map/process-chat", {
      target,
      // The model only needs the words — diffs stay client-side.
      messages: next
        .filter((m) => m.content !== greeting)
        .map((m) => ({ role: m.role, content: m.content })),
    });
  }, [input, running, messages, start, target, greeting]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function startOver() {
    consume();
    setApplyError(null);
    setInput("");
    setMessages([{ role: "assistant", content: greeting }]);
    try {
      window.sessionStorage.removeItem(storageKey(target));
    } catch {
      /* ignore */
    }
  }

  async function applyChanges(idx: number) {
    const msg = messages[idx];
    if (!msg?.changes || msg.appliedUrl) return;
    setApplyingIdx(idx);
    setApplyError(null);
    try {
      const res = await fetch("/api/map/process-chat/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          summary: msg.content,
          changes: msg.changes.map((c) => ({
            file: c.file,
            newContent: c.newContent,
            delete: c.delete ?? false,
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't apply the changes.");
      setMessages((prev) =>
        prev.map((m, i) => (i === idx ? { ...m, appliedUrl: j.commitUrl ?? "" } : m)),
      );
      onApplied?.();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Couldn't apply the changes.");
    } finally {
      setApplyingIdx(null);
    }
  }

  return (
    <div className="flex h-[68vh] min-h-[440px] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
            <Bot className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-zinc-100">Edit with AI</p>
            <p className="text-[11px] text-zinc-500">
              Nothing is saved until you tap “Apply changes”
            </p>
          </div>
        </div>
        <button
          onClick={startOver}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Start over
        </button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] whitespace-pre-wrap rounded-2xl bg-emerald-500 px-3 py-2 text-sm text-zinc-950"
                  : `${m.changes ? "w-full max-w-full" : "max-w-[85%]"} space-y-3 whitespace-pre-wrap rounded-2xl bg-zinc-800 px-3 py-2 text-sm text-zinc-100`
              }
            >
              {m.content}
              {m.changes && (
                <div className="space-y-3 whitespace-normal rounded-lg border border-zinc-700 bg-zinc-950 p-3">
                  {m.changes.map((c) => (
                    <ChangeBlock key={c.file} change={c} />
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    {m.appliedUrl !== undefined ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                        <Check className="h-3.5 w-3.5" /> Applied — saved as one change.
                        {m.appliedUrl && (
                          <a
                            className="underline"
                            href={m.appliedUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View it on GitHub
                          </a>
                        )}
                      </span>
                    ) : (
                      <button
                        disabled={applyingIdx !== null}
                        onClick={() => applyChanges(i)}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
                      >
                        {applyingIdx === i ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        Apply changes
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {running && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-zinc-800 px-3 py-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Claude is working… {formatElapsed(elapsedSec)}. Big changes can take a few minutes —
              you can leave this page; the reply will be here when you come back.
            </div>
          </div>
        )}

        {(submitError || applyError) && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {submitError ?? applyError}
          </div>
        )}

        {jobError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {jobError}
              <button onClick={() => consume()} className="ml-2 underline">
                Dismiss
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-zinc-800 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder='e.g. "Make Scout run twice a day and focus on money-making ideas"'
            className="max-h-40 min-h-[3.25rem] flex-1 resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={send}
            disabled={running || !input.trim()}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-zinc-600">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}

/** One drafted file change: collapsible diff, with add/remove badges. */
function ChangeBlock({ change }: { change: FileChange }) {
  const [open, setOpen] = useState(true);
  const isNew = change.oldContent === null;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {fileLabel(change.file)}
        <span className="font-mono text-[10px] text-zinc-500">{change.file}</span>
        {change.delete ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300">
            <Trash2 className="h-3 w-3" /> will be removed
          </span>
        ) : isNew ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
            new file
          </span>
        ) : null}
      </button>
      {open && <InlineDiff oldText={change.oldContent ?? ""} newText={change.newContent} />}
    </div>
  );
}
