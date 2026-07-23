"use client";

import { useCallback, useEffect, useState } from "react";

export type PrChatMsg = { role: "user" | "assistant"; content: string };

function storageKey(prNumber: number): string {
  return `loop-dash-pr-chat-${prNumber}`;
}

function load(prNumber: number): PrChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(storageKey(prNumber));
    if (raw) {
      const parsed = JSON.parse(raw) as { messages?: PrChatMsg[] };
      if (Array.isArray(parsed.messages)) return parsed.messages;
    }
  } catch {
    /* ignore corrupt storage */
  }
  return [];
}

/**
 * A private, per-PR chat with Claude — never posted to GitHub. Persisted in
 * sessionStorage so it survives collapsing/reopening the card. The backend
 * gives Claude the PR's diff plus read-only access to the local checkout, so
 * answers are grounded in the actual code, not the PR's description.
 */
export function usePrChat(prNumber: number) {
  const [messages, setMessages] = useState<PrChatMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setMessages(load(prNumber));
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
  }, [prNumber]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(
        storageKey(prNumber),
        JSON.stringify({ messages }),
      );
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [prNumber, messages, hydrated]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      const next = [...messages, { role: "user" as const, content: trimmed }];
      setMessages(next);
      setError(null);
      setSending(true);
      try {
        const res = await fetch(`/api/builds/${prNumber}/chat`, {
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
    [prNumber, messages, sending],
  );

  return { messages, sendMessage, sending, error };
}
