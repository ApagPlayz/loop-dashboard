"use client";

import { useRef, useState } from "react";
import { Bot, Loader2, Send, User } from "lucide-react";
import { Markdown } from "./ui";
import type { useIdeaChat } from "./use-idea-chat";

/**
 * Private, local chat about one idea — billed through the owner's Claude Max
 * subscription (the same local-CLI backend as the rest of the dashboard's AI
 * features), scoped to just this idea and its repo. Nothing here is posted to
 * GitHub on its own; the "include" toggle below only affects what gets
 * attached when the owner actually approves / sends back / rejects.
 */
export default function IdeaChat({ chat }: { chat: ReturnType<typeof useIdeaChat> }) {
  const { messages, sendMessage, sending, error, includeInAction, setIncludeInAction } = chat;
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    if (!input.trim() || sending) return;
    const text = input;
    setInput("");
    void sendMessage(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
          <Bot className="h-3.5 w-3.5" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Chat with Claude — private, just for you
        </p>
      </div>

      {messages.length > 0 && (
        <div className="mb-3 max-h-72 space-y-3 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
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
      )}

      {error && (
        <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Claude anything about this idea before you decide…"
          rows={2}
          className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
        />
        <button
          onClick={submit}
          disabled={sending || !input.trim()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={includeInAction}
          onChange={(e) => setIncludeInAction(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-emerald-500"
        />
        Include this chat when I approve, send back, or reject
      </label>
    </div>
  );
}
