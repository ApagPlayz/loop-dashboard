"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogEntry, ToolType } from "@/components/tools/catalog-browser";

export type CustomIdeaMsg = { role: "user" | "assistant"; content: string };

/** The slim tool shape we persist and send to the backend / submit route. */
export type AttachedTool = { id: string; name: string; type: ToolType; url: string };

/** A tool Claude suggested during a chat turn — an AttachedTool plus a reason. */
export type SuggestedTool = AttachedTool & { reason: string };

export type CustomDraft = { title: string; body: string };

type Persisted = {
  messages: CustomIdeaMsg[];
  draft: CustomDraft;
  attachedTools: AttachedTool[];
  suggestedTools: SuggestedTool[];
};

const EMPTY: Persisted = {
  messages: [],
  draft: { title: "", body: "" },
  attachedTools: [],
  suggestedTools: [],
};

function storageKey(project: string): string {
  return `customIdeaDraft:v1:${project}`;
}

function load(project: string): Persisted {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.sessionStorage.getItem(storageKey(project));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return {
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        draft: {
          title: parsed.draft?.title ?? "",
          body: parsed.draft?.body ?? "",
        },
        attachedTools: Array.isArray(parsed.attachedTools) ? parsed.attachedTools : [],
        suggestedTools: Array.isArray(parsed.suggestedTools) ? parsed.suggestedTools : [],
      };
    }
  } catch {
    /* ignore corrupt storage */
  }
  return EMPTY;
}

function slim(entry: CatalogEntry): AttachedTool {
  return { id: entry.id, name: entry.name, type: entry.type, url: entry.url };
}

/**
 * The continuous drafting hook for the "Custom idea" composer. Mirrors
 * `use-idea-chat.ts`, but drives a PRE-creation draft: the owner refines an
 * idea's title/body in an ongoing chat with Claude while also hand-editing the
 * draft and attaching integrations. Chat edits and manual edits share one
 * source of truth (the `draft` state).
 *
 * Everything is persisted to sessionStorage per project so it survives closing
 * and reopening the composer, and each turn sends the CURRENT (possibly
 * hand-edited) draft and replaces it with the full updated draft that comes
 * back.
 */
export function useCustomIdeaChat(project: string) {
  const [messages, setMessages] = useState<CustomIdeaMsg[]>([]);
  const [draft, setDraft] = useState<CustomDraft>({ title: "", body: "" });
  const [attachedTools, setAttachedTools] = useState<AttachedTool[]>([]);
  const [rawSuggested, setRawSuggested] = useState<SuggestedTool[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tracks which project the current in-memory state belongs to. The persist
  // effect only writes once this matches `project`, so switching projects never
  // writes the previous project's state into the new project's storage key
  // before its own draft has been (re)hydrated.
  const loadedProjectRef = useRef<string | null>(null);

  // (Re)hydrate whenever the project changes — each project keeps its own draft.
  useEffect(() => {
    // Defer so we don't call setState synchronously inside the effect body.
    const t = setTimeout(() => {
      const p = load(project);
      setMessages(p.messages);
      setDraft(p.draft);
      setAttachedTools(p.attachedTools);
      setRawSuggested(p.suggestedTools);
      loadedProjectRef.current = project;
    }, 0);
    return () => clearTimeout(t);
  }, [project]);

  // Persist as anything changes (only once the loaded state is for THIS project).
  useEffect(() => {
    if (loadedProjectRef.current !== project) return;
    try {
      window.sessionStorage.setItem(
        storageKey(project),
        JSON.stringify({
          messages,
          draft,
          attachedTools,
          suggestedTools: rawSuggested,
        } satisfies Persisted),
      );
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [project, messages, draft, attachedTools, rawSuggested]);

  const setDraftTitle = useCallback((title: string) => {
    setDraft((d) => ({ ...d, title }));
  }, []);

  const setDraftBody = useCallback((body: string) => {
    setDraft((d) => ({ ...d, body }));
  }, []);

  const attachTool = useCallback((entry: CatalogEntry) => {
    setAttachedTools((prev) => (prev.some((t) => t.id === entry.id) ? prev : [...prev, slim(entry)]));
  }, []);

  const detachTool = useCallback((id: string) => {
    setAttachedTools((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const acceptSuggested = useCallback((id: string) => {
    setRawSuggested((prev) => {
      const found = prev.find((t) => t.id === id);
      if (found) {
        setAttachedTools((cur) =>
          cur.some((t) => t.id === id)
            ? cur
            : [...cur, { id: found.id, name: found.name, type: found.type, url: found.url }],
        );
      }
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const dismissSuggested = useCallback((id: string) => {
    setRawSuggested((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      const nextMessages = [...messages, { role: "user" as const, content: trimmed }];
      setMessages(nextMessages);
      setError(null);
      setSending(true);
      try {
        const res = await fetch("/api/ideas/custom/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project,
            title: draft.title,
            body: draft.body,
            messages: nextMessages,
            attachedToolIds: attachedTools.map((t) => t.id),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          title?: string;
          body?: string;
          suggestedTools?: SuggestedTool[];
          error?: string;
        };
        if (!res.ok || typeof data.reply !== "string") {
          setError(data.error || "Claude couldn't answer just now. Try again.");
          return;
        }
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply as string }]);
        // The chat returns the FULL updated draft each turn — replace ours.
        setDraft((d) => ({
          title: typeof data.title === "string" ? data.title : d.title,
          body: typeof data.body === "string" ? data.body : d.body,
        }));
        setRawSuggested(Array.isArray(data.suggestedTools) ? data.suggestedTools : []);
      } catch {
        setError("Couldn't reach Claude. Check your connection and try again.");
      } finally {
        setSending(false);
      }
    },
    [project, draft.title, draft.body, messages, attachedTools, sending],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setDraft({ title: "", body: "" });
    setAttachedTools([]);
    setRawSuggested([]);
    setError(null);
    try {
      window.sessionStorage.removeItem(storageKey(project));
    } catch {
      /* ignore */
    }
  }, [project]);

  // Only surface suggestions that aren't already attached.
  const suggestedTools = useMemo(() => {
    const attachedIds = new Set(attachedTools.map((t) => t.id));
    return rawSuggested.filter((t) => !attachedIds.has(t.id));
  }, [rawSuggested, attachedTools]);

  return {
    messages,
    draft,
    attachedTools,
    suggestedTools,
    sending,
    error,
    hasContent:
      messages.length > 0 ||
      draft.title.trim().length > 0 ||
      draft.body.trim().length > 0 ||
      attachedTools.length > 0,
    sendMessage,
    setDraftTitle,
    setDraftBody,
    attachTool,
    detachTool,
    acceptSuggested,
    dismissSuggested,
    reset,
  };
}
