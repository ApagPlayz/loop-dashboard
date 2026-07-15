"use client";

import { useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { Spinner } from "./ui";

/**
 * Plain-comment composer with the shared "wake Claude on this" checkbox. When
 * checked, the parent should prepend `@claude ` (handled server-side via the
 * `wakeClaude` flag) so the mention agent responds.
 */
export default function CommentBox({
  onSubmit,
  placeholder = "Write a comment…",
  submitLabel = "Comment",
  showWakeClaude = true,
}: {
  onSubmit: (text: string, wakeClaude: boolean) => Promise<void>;
  placeholder?: string;
  submitLabel?: string;
  showWakeClaude?: boolean;
}) {
  const [text, setText] = useState("");
  const [wake, setWake] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim(), wake);
      setText("");
      setWake(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        {showWakeClaude ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={wake}
              onChange={(e) => setWake(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-emerald-500"
            />
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            Wake Claude on this
          </label>
        ) : (
          <span />
        )}
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Spinner /> : <Send className="h-4 w-4" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
