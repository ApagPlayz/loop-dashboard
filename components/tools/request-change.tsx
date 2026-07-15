"use client";

import { useState } from "react";
import { MessageSquarePlus, ExternalLink } from "lucide-react";

/**
 * "Request a change" box for shared tools — opens a plain issue on the target
 * repo whose body starts with @claude so the mention agent handles it.
 */
export default function RequestChange() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url?: string; error?: string } | null>(
    null,
  );

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/tools/request-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: text.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ url: data.url });
        setText("");
      } else {
        setResult({ error: data.error ?? "Couldn't send." });
      }
    } catch {
      setResult({ error: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
        <MessageSquarePlus className="h-3.5 w-3.5 text-emerald-400" />
        Ask Claude to change or remove a shared tool
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder='e.g. "Remove the github MCP server from all agents"'
        className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500">
          Claude will reply on the issue and open a build if changes are needed.
        </p>
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
      </div>
      {result?.url && (
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
        >
          Sent — view the issue <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {result?.error && (
        <p className="mt-2 text-xs text-amber-300">{result.error}</p>
      )}
    </div>
  );
}
