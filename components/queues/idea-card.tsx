"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  ThumbsUp,
  Undo2,
  CornerUpLeft,
  X,
  ExternalLink,
} from "lucide-react";
import type { IdeaSummary, ThreadComment } from "@/lib/queues";
import { Markdown, relativeTime, Spinner, ErrorPanel } from "./ui";
import CommentThread from "./comment-thread";
import CommentBox from "./comment-box";
import { useToast } from "./toast";

type ActionKind = "approve" | "unapprove" | "redraft" | "reject" | "comment";

function labelBadge(labels: string[]) {
  if (labels.includes("proposal"))
    return { text: "Waiting for you", cls: "bg-amber-500/15 text-amber-300" };
  if (labels.includes("approved"))
    return { text: "Approved", cls: "bg-emerald-500/15 text-emerald-300" };
  if (labels.includes("redraft"))
    return { text: "Being redrafted", cls: "bg-sky-500/15 text-sky-300" };
  return { text: "Closed", cls: "bg-zinc-700/40 text-zinc-400" };
}

export default function IdeaCard({
  idea,
  onChanged,
}: {
  idea: IdeaSummary;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<ThreadComment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"feedback" | "reject" | null>(null);
  const [panelText, setPanelText] = useState("");
  const [busy, setBusy] = useState<ActionKind | null>(null);

  const badge = labelBadge(idea.labels);
  const isProposal = idea.labels.includes("proposal") && idea.state === "open";
  const isApproved =
    idea.labels.includes("approved") &&
    !idea.labels.includes("proposal") &&
    idea.state === "open";

  async function loadComments() {
    if (comments || loadingComments) return;
    setLoadingComments(true);
    setCommentsError(null);
    try {
      const res = await fetch(`/api/ideas/${idea.number}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load comments");
      setComments(data.comments as ThreadComment[]);
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoadingComments(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) loadComments();
  }

  async function act(
    action: ActionKind,
    opts: { text?: string; wakeClaude?: boolean } = {},
  ): Promise<boolean> {
    setBusy(action);
    try {
      const res = await fetch(`/api/ideas/${idea.number}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...opts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (await act("approve")) {
      toast.success(
        "Approved — the Builder will pick this up tonight (or trigger it from Testing).",
      );
      onChanged();
    }
  }

  async function unapprove() {
    if (await act("unapprove")) {
      toast.success("Moved back to “Waiting for you”.");
      onChanged();
    }
  }

  async function submitFeedback() {
    if (!panelText.trim()) {
      toast.error("Add some feedback so the agent knows what to change.");
      return;
    }
    if (await act("redraft", { text: panelText.trim() })) {
      toast.success(
        "Sent back. The agent will rewrite this idea and it'll return to “Waiting for you”.",
      );
      setPanel(null);
      setPanelText("");
      onChanged();
    }
  }

  async function submitReject() {
    if (await act("reject", { text: panelText.trim() || undefined })) {
      toast.success("Idea rejected and closed.");
      setPanel(null);
      setPanelText("");
      onChanged();
    }
  }

  async function submitComment(text: string, wakeClaude: boolean) {
    if (await act("comment", { text, wakeClaude })) {
      toast.success(
        wakeClaude ? "Comment posted — Claude will respond." : "Comment posted.",
      );
      // refresh the thread
      setComments(null);
      await loadComments();
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      {/* Header */}
      <button
        onClick={toggle}
        className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-zinc-800/40"
      >
        <span className="mt-0.5 shrink-0 text-zinc-500">
          {open ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}
            >
              {badge.text}
            </span>
            <span className="text-xs text-zinc-500">#{idea.number}</span>
          </div>
          <p className="mt-1.5 font-medium leading-snug text-zinc-100">
            {idea.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span>opened {relativeTime(idea.createdAt)}</span>
            {idea.state === "closed" && idea.closedAt && (
              <span>closed {relativeTime(idea.closedAt)}</span>
            )}
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" />
              {idea.commentCount}
            </span>
          </div>
        </div>
      </button>

      {/* Expanded */}
      {open && (
        <div className="border-t border-zinc-800 p-4">
          <div className="mb-2 flex justify-end">
            <a
              href={idea.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400"
            >
              Open on GitHub <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {idea.body.trim() ? (
            <Markdown>{idea.body}</Markdown>
          ) : (
            <p className="text-sm text-zinc-500">No description.</p>
          )}

          {/* Actions */}
          {isProposal && (
            <div className="mt-4 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={approve}
                  disabled={busy !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy === "approve" ? <Spinner /> : <ThumbsUp className="h-4 w-4" />}
                  Approve
                </button>
                <button
                  onClick={() => {
                    setPanel(panel === "feedback" ? null : "feedback");
                    setPanelText("");
                  }}
                  disabled={busy !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-700 bg-sky-950/40 px-4 py-3 text-sm font-semibold text-sky-200 transition hover:bg-sky-900/40 disabled:opacity-50"
                >
                  <CornerUpLeft className="h-4 w-4" />
                  Send back with feedback
                </button>
              </div>
              <button
                onClick={() => {
                  setPanel(panel === "reject" ? null : "reject");
                  setPanelText("");
                }}
                disabled={busy !== null}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-900 px-4 py-2.5 text-sm font-medium text-red-300 transition hover:bg-red-950/40 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                Reject
              </button>
            </div>
          )}

          {isApproved && (
            <div className="mt-4">
              <button
                onClick={unapprove}
                disabled={busy !== null}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy === "unapprove" ? <Spinner /> : <Undo2 className="h-4 w-4" />}
                Un-approve (back to waiting)
              </button>
            </div>
          )}

          {/* Feedback / reject text panel */}
          {panel && (
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                {panel === "feedback"
                  ? "What should the agent change? (required)"
                  : "Reason for rejecting (optional)"}
              </label>
              <textarea
                value={panelText}
                onChange={(e) => setPanelText(e.target.value)}
                rows={4}
                placeholder={
                  panel === "feedback"
                    ? "e.g. Good idea, but scope it to just the sports channel first…"
                    : "e.g. Duplicate of #12"
                }
                className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setPanel(null);
                    setPanelText("");
                  }}
                  className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  onClick={panel === "feedback" ? submitFeedback : submitReject}
                  disabled={busy !== null}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                    panel === "feedback"
                      ? "bg-sky-600 hover:bg-sky-500"
                      : "bg-red-600 hover:bg-red-500"
                  }`}
                >
                  {busy === "redraft" || busy === "reject" ? <Spinner /> : null}
                  {panel === "feedback" ? "Send back for redraft" : "Reject & close"}
                </button>
              </div>
            </div>
          )}

          {/* Comment thread */}
          <div className="mt-5">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Conversation
            </h4>
            {commentsError ? (
              <ErrorPanel
                message={commentsError}
                onRetry={() => {
                  setComments(null);
                  loadComments();
                }}
              />
            ) : (
              <CommentThread
                comments={comments ?? []}
                loading={loadingComments && !comments}
              />
            )}
          </div>

          {/* Comment box */}
          {idea.state === "open" && (
            <div className="mt-3">
              <CommentBox
                onSubmit={submitComment}
                placeholder="Add a comment for the record…"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
