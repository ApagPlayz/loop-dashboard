"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { KeyRound, ExternalLink, Check, Send } from "lucide-react";
import { relativeTime } from "@/components/testing/format";
import { useProject } from "@/components/project-context";

type ActionIssue = {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  createdAt: string;
};

function IssueCard({
  issue,
  onDone,
}: {
  issue: ActionIssue;
  onDone: (n: number) => void;
}) {
  const { project } = useProject();
  const [comment, setComment] = useState("");
  const [wake, setWake] = useState(true);
  const [busy, setBusy] = useState<"" | "close" | "comment">("");
  const [flash, setFlash] = useState<string | null>(null);

  async function act(
    action: "close" | "comment",
    extra: Record<string, unknown> = {},
  ) {
    setBusy(action);
    setFlash(null);
    try {
      const res = await fetch("/api/tools/issue-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, action, number: issue.number, ...extra }),
      });
      const data = await res.json();
      if (res.ok) {
        if (action === "close") onDone(issue.number);
        else {
          setComment("");
          setFlash("Sent.");
        }
      } else {
        setFlash(data.error ?? "That didn't go through.");
      }
    } catch {
      setFlash("Network error — try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-start gap-2 text-sm font-semibold text-amber-100">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          {issue.title}
        </h3>
        <a
          href={issue.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-amber-300/70 hover:text-amber-200"
          title="Open on GitHub"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
      <p className="mt-0.5 pl-6 text-[11px] text-amber-300/60">
        #{issue.number} · opened {relativeTime(issue.createdAt)}
      </p>

      <div className="prose-dashboard mt-3 rounded-lg border border-amber-500/20 bg-zinc-950/40 p-3">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {issue.body || "_No details provided._"}
        </ReactMarkdown>
      </div>

      {/* Comment box */}
      <div className="mt-3">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="Reply or ask a question…"
          className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={wake}
              onChange={(e) => setWake(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            Wake Claude (adds @claude so it replies)
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                act("comment", { body: comment, wake })
              }
              disabled={busy !== "" || !comment.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {busy === "comment" ? "Sending…" : "Send"}
            </button>
            <button
              onClick={() => act("close")}
              disabled={busy !== ""}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {busy === "close" ? "…" : "Mark done"}
            </button>
          </div>
        </div>
        {flash && <p className="mt-2 text-xs text-emerald-400">{flash}</p>}
      </div>
    </div>
  );
}

export default function NeedsYou() {
  const { project } = useProject();
  const [issues, setIssues] = useState<ActionIssue[] | null>(null);

  const load = useCallback(async () => {
    if (!project) return;
    try {
      const res = await fetch(
        `/api/tools/needs-you?project=${encodeURIComponent(project)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      setIssues(data.issues ?? []);
    } catch {
      setIssues([]);
    }
  }, [project]);

  useEffect(() => {
    // Switching project must clear the previous project's tasks immediately —
    // showing them under a new heading is exactly the bug this scoping fixes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIssues(null);
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (issues === null) {
    return <p className="text-sm text-zinc-500">Checking for tasks…</p>;
  }
  if (issues.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">
        Nothing needs you right now. If a tool install needs an account or a key,
        the task will show up here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {issues.map((i) => (
        <IssueCard
          key={i.number}
          issue={i}
          onDone={(n) =>
            setIssues((p) => (p ? p.filter((x) => x.number !== n) : p))
          }
        />
      ))}
    </div>
  );
}
