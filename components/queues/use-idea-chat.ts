"use client";

import { useCallback, useEffect, useState } from "react";

export type IdeaChatMsg = { role: "user" | "assistant"; content: string };

type Persisted = { messages: IdeaChatMsg[]; includeInAction: boolean };

function storageKey(project: string, issueNumber: number): string {
  return `loop-dash-idea-chat-${project}-${issueNumber}`;
}

function load(project: string, issueNumber: number): Persisted {
  if (typeof window === "undefined") return { messages: [], includeInAction: true };
  try {
    const raw = window.sessionStorage.getItem(storageKey(project, issueNumber));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      if (Array.isArray(parsed.messages)) {
        return {
          messages: parsed.messages,
          includeInAction: parsed.includeInAction ?? true,
        };
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  return { messages: [], includeInAction: true };
}

/**
 * A private, per-idea chat with Claude — never posted to GitHub on its own.
 * Persisted in sessionStorage so it survives collapsing/reopening the card,
 * but never leaves the browser unless the owner explicitly includes it when
 * approving / sending back / rejecting.
 */
export function useIdeaChat(project: string, issueNumber: number) {
  const [messages, setMessages] = useState<IdeaChatMsg[]>([]);
  const [includeInAction, setIncludeInAction] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Defer so we don't call setState synchronously inside the effect body.
    const t = setTimeout(() => {
      const p = load(project, issueNumber);
      setMessages(p.messages);
      setIncludeInAction(p.includeInAction);
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
  }, [project, issueNumber]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(
        storageKey(project, issueNumber),
        JSON.stringify({ messages, includeInAction } satisfies Persisted),
      );
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [project, issueNumber, messages, includeInAction, hydrated]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      const next = [...messages, { role: "user" as const, content: trimmed }];
      setMessages(next);
      setError(null);
      setSending(true);
      try {
        const res = await fetch(`/api/ideas/${issueNumber}/chat?project=${encodeURIComponent(project)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next }),
        });
        const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
        if (!res.ok || !data.reply) {
          setError(data.error || "Claude couldn't answer just now. Try again.");
          return;
        }
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply as string }]);
      } catch {
        setError("Couldn't reach Claude. Check your connection and try again.");
      } finally {
        setSending(false);
      }
    },
    [issueNumber, project, messages, sending],
  );

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    try {
      window.sessionStorage.removeItem(storageKey(project, issueNumber));
    } catch {
      /* ignore */
    }
  }, [project, issueNumber]);

  const transcriptText = messages.length
    ? messages
        .map((m) => `${m.role === "user" ? "Owner" : "Claude"}: ${m.content}`)
        .join("\n\n")
    : "";

  return {
    messages,
    sendMessage,
    sending,
    error,
    includeInAction,
    setIncludeInAction,
    hasContent: messages.length > 0,
    transcriptText,
    clear,
  };
}
