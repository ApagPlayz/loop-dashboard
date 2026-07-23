"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  GitMerge,
  XCircle,
  ExternalLink,
  Check,
  CornerUpLeft,
  X,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldQuestion,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import type {
  PRSummary,
  PRDetail,
  VerdictLevel,
  AuditVerdict,
} from "@/lib/queues";
import { Markdown, relativeTime, Spinner, ErrorPanel } from "./ui";
import CommentThread from "./comment-thread";
import CommentBox from "./comment-box";
import EvidenceViewer, { RerunButton } from "./evidence-viewer";
import PrChat from "./pr-chat";
import { usePrChat } from "./use-pr-chat";
import { useToast } from "./toast";

type Decision =
  | "merge"
  | "sendback"
  | "close"
  | "comment"
  | "redemo"
  | "reaudit"
  | "rebuild";

// Below this many commits behind main, an open (non-conflicting) PR is
// "getting stale" and worth a heads-up before it turns into a hard conflict.
const STALE_THRESHOLD = 10;

export default function PRCard({
  pr,
  onChanged,
}: {
  pr: PRSummary;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PRDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<
    "merge" | "sendback" | "close" | "rebuild" | null
  >(null);
  const chat = usePrChat(pr.number);
  const [panelText, setPanelText] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);

  async function loadDetail() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/builds/${pr.number}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load PR");
      setDetail(data as PRDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PR");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail) loadDetail();
  }

  async function act(
    action: Decision,
    opts: { text?: string; wakeClaude?: boolean } = {},
  ): Promise<boolean> {
    setBusy(action);
    try {
      const res = await fetch(`/api/builds/${pr.number}`, {
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

  async function confirmMerge() {
    if (await act("merge")) {
      toast.success("Merged! The change is going live.");
      setPanel(null);
      onChanged();
    }
  }

  async function submitSendback() {
    if (!panelText.trim()) {
      toast.error("Describe the changes you want first.");
      return;
    }
    if (await act("sendback", { text: panelText.trim() })) {
      toast.success("Sent back — Claude will push fixes to this same PR.");
      setPanel(null);
      setPanelText("");
      await loadDetail();
    }
  }

  async function submitClose() {
    if (await act("close", { text: panelText.trim() || undefined })) {
      toast.success("PR closed without merging.");
      setPanel(null);
      setPanelText("");
      onChanged();
    }
  }

  async function submitComment(text: string, wakeClaude: boolean) {
    if (await act("comment", { text, wakeClaude })) {
      toast.success(wakeClaude ? "Comment posted — Claude will respond." : "Comment posted.");
      await loadDetail();
    }
  }

  async function rerunDemo() {
    if (await act("redemo")) {
      toast.success("Demo agent triggered — evidence will appear here shortly.");
    }
  }

  async function rerunAudit() {
    if (await act("reaudit")) {
      toast.success("Auditor triggered — a fresh verdict will appear here shortly.");
    }
  }

  async function confirmRebuild() {
    if (await act("rebuild")) {
      toast.success(
        "Sent back to rebuild — the Builder will recreate it fresh against main.",
      );
      setPanel(null);
      onChanged();
    }
  }

  const isOpen = pr.state === "open";
  // The REST API's mergeable_state reports "dirty" specifically for merge
  // conflicts (as opposed to "blocked"/"unstable" for failing checks, etc.).
  const conflicting =
    isOpen &&
    !!detail &&
    detail.mergeable === false &&
    detail.mergeableState === "dirty";
  // Not yet conflicting, but drifting behind main — a heads-up so the user
  // can merge or rebuild before it turns into a hard conflict. The red
  // conflict banner always wins if both would technically apply.
  const stale =
    isOpen &&
    !!detail &&
    !conflicting &&
    (detail.behindBy ?? 0) >= STALE_THRESHOLD;
  // Best-effort guess for the confirm-panel copy only — the API route does
  // its own authoritative lookup when the action actually runs.
  const guessedIdea = detail ? guessSourceIdea(detail) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      {/* Collapsed header */}
      <button
        onClick={toggle}
        className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-zinc-800/40"
      >
        <span className="mt-0.5 shrink-0 text-zinc-500">
          {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatePill pr={pr} />
            <span className="text-xs text-zinc-500">#{pr.number}</span>
          </div>
          <p className="mt-1.5 font-medium leading-snug text-zinc-100">{pr.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span className="font-mono">{pr.headRef}</span>
            <span>opened {relativeTime(pr.createdAt)}</span>
            {pr.merged && pr.mergedAt && <span>merged {relativeTime(pr.mergedAt)}</span>}
            {!pr.merged && pr.state === "closed" && pr.closedAt && (
              <span>closed {relativeTime(pr.closedAt)}</span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-zinc-800">
          {loading && !detail ? (
            <div className="flex items-center gap-2 p-5 text-sm text-zinc-500">
              <Spinner /> Loading pull request…
            </div>
          ) : error ? (
            <div className="p-4">
              <ErrorPanel message={error} onRetry={loadDetail} />
            </div>
          ) : detail ? (
            <div className="space-y-6 p-4">
              {/* 0. Conflict notice */}
              {conflicting && (
                <div className="rounded-xl border border-red-800 bg-red-950/40 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Conflicts with main — this can&apos;t be merged as-is.
                  </p>
                  <p className="mt-1 text-sm text-red-300/90">
                    The code changed underneath it. Rebuild it fresh and the loop will recreate it cleanly.
                  </p>
                  <button
                    onClick={() => {
                      setPanel(panel === "rebuild" ? null : "rebuild");
                    }}
                    disabled={busy !== null}
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" /> Rebuild fresh
                  </button>

                  {panel === "rebuild" && (
                    <div className="mt-3 rounded-xl border border-red-900 bg-red-950/60 p-3">
                      <p className="text-sm text-red-100">
                        Close this PR and send idea{" "}
                        {guessedIdea ? `#${guessedIdea}` : "its source idea"}{" "}
                        back to be rebuilt? The current PR will be discarded.
                      </p>
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          onClick={() => setPanel(null)}
                          className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={confirmRebuild}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                        >
                          {busy === "rebuild" ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
                          Confirm rebuild
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 0b. Falling-behind notice (only when not already conflicting) */}
              {stale && (
                <div className="rounded-xl border border-amber-700 bg-amber-950/40 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    ⏳ This PR is {detail.behindBy} commits behind main — it
                    may start conflicting soon.
                  </p>
                  <p className="mt-1 text-sm text-amber-300/90">
                    Merge it now, or Rebuild fresh to recreate it cleanly.
                  </p>
                  <button
                    onClick={() => {
                      setPanel(panel === "rebuild" ? null : "rebuild");
                    }}
                    disabled={busy !== null}
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-amber-700 bg-amber-900/40 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-900/70 disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" /> Rebuild fresh
                  </button>

                  {panel === "rebuild" && (
                    <div className="mt-3 rounded-xl border border-amber-900 bg-amber-950/60 p-3">
                      <p className="text-sm text-amber-100">
                        Close this PR and send idea{" "}
                        {guessedIdea ? `#${guessedIdea}` : "its source idea"}{" "}
                        back to be rebuilt? The current PR will be discarded.
                      </p>
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          onClick={() => setPanel(null)}
                          className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={confirmRebuild}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                        >
                          {busy === "rebuild" ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
                          Confirm rebuild
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 1. Header stats */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-1.5 text-zinc-300">
                  <span className="font-mono text-emerald-400">+{detail.additions}</span>
                  <span className="font-mono text-red-400">−{detail.deletions}</span>
                </span>
                <span className="text-zinc-400">
                  {detail.changedFiles} file{detail.changedFiles === 1 ? "" : "s"} changed
                </span>
                <span className="text-zinc-500">
                  {detail.baseRef} ← {detail.headRef}
                </span>
                <a
                  href={detail.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400"
                >
                  Open on GitHub <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {detail.body.trim() && (
                <details className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-300">
                    What this PR says it does
                  </summary>
                  <div className="mt-2">
                    <Markdown>{detail.body}</Markdown>
                  </div>
                </details>
              )}

              {/* 2. Audit verdict */}
              <section>
                <SectionTitle>Auditor verdict</SectionTitle>
                <VerdictBadge verdict={detail.verdict} onRerun={rerunAudit} busy={busy === "reaudit"} />
              </section>

              {/* 3. Demo evidence */}
              <section>
                <SectionTitle>📸 Demo evidence</SectionTitle>
                <EvidenceViewer pr={pr.number} demo={detail.demo} onRerun={rerunDemo} />
              </section>

              {/* 4. Decision row (sticky on mobile) */}
              {isOpen && (
                <section>
                  <SectionTitle>Your decision</SectionTitle>
                  <div className="sticky bottom-16 z-10 rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur md:static md:bg-transparent md:p-0 md:backdrop-blur-none">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <button
                        onClick={() => setPanel(panel === "merge" ? null : "merge")}
                        disabled={busy !== null}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" /> Approve &amp; merge
                      </button>
                      <button
                        onClick={() => {
                          setPanel(panel === "sendback" ? null : "sendback");
                          setPanelText("");
                        }}
                        disabled={busy !== null}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-700 bg-sky-950/40 px-4 py-3 text-sm font-semibold text-sky-200 transition hover:bg-sky-900/40 disabled:opacity-50"
                      >
                        <CornerUpLeft className="h-4 w-4" /> Send back
                      </button>
                      <button
                        onClick={() => {
                          setPanel(panel === "close" ? null : "close");
                          setPanelText("");
                        }}
                        disabled={busy !== null}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-900 px-4 py-3 text-sm font-medium text-red-300 transition hover:bg-red-950/40 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" /> Close
                      </button>
                    </div>

                    {/* Merge confirm */}
                    {panel === "merge" && (
                      <div className="mt-3 rounded-xl border border-emerald-900 bg-emerald-950/30 p-3">
                        <p className="text-sm text-emerald-100">
                          This will squash-merge <span className="font-mono">{detail.headRef}</span>{" "}
                          into <span className="font-mono">{detail.baseRef}</span> and go live.
                        </p>
                        {detail.mergeable === false && (
                          <p className="mt-2 text-sm text-amber-300">
                            GitHub says this PR can&apos;t be merged right now (state:{" "}
                            {detail.mergeableState}). It may have conflicts or failing checks.
                          </p>
                        )}
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            onClick={() => setPanel(null)}
                            className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={confirmMerge}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {busy === "merge" ? <Spinner /> : <GitMerge className="h-4 w-4" />}
                            Confirm merge
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Send back / close text panels */}
                    {(panel === "sendback" || panel === "close") && (
                      <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                        <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                          {panel === "sendback"
                            ? "What changes do you want? (required — sent to Claude)"
                            : "Reason for closing (optional)"}
                        </label>
                        <textarea
                          value={panelText}
                          onChange={(e) => setPanelText(e.target.value)}
                          rows={4}
                          placeholder={
                            panel === "sendback"
                              ? "e.g. The button should be green, and add a confirmation step…"
                              : "e.g. Superseded by #45"
                          }
                          className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
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
                            onClick={panel === "sendback" ? submitSendback : submitClose}
                            disabled={busy !== null}
                            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                              panel === "sendback"
                                ? "bg-sky-600 hover:bg-sky-500"
                                : "bg-red-600 hover:bg-red-500"
                            }`}
                          >
                            {busy === "sendback" || busy === "close" ? <Spinner /> : null}
                            {panel === "sendback" ? "Send to Claude" : "Close PR"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* 5. Comments thread + box */}
              <section>
                <SectionTitle>Conversation</SectionTitle>
                <CommentThread comments={detail.comments} />
                {isOpen && (
                  <div className="mt-3">
                    <CommentBox onSubmit={submitComment} placeholder="Reply on this PR…" />
                  </div>
                )}
              </section>

              {/* 6. Private, code-aware chat about this PR */}
              <section>
                <PrChat chat={chat} />
              </section>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Client-side, best-effort guess at the source idea number, purely for the
 * "Rebuild fresh" confirm copy. Mirrors the server-side lookup in
 * app/api/builds/[pr]/route.ts, which is the authoritative version.
 */
function guessSourceIdea(detail: PRDetail): number | null {
  const bodyMatch = detail.body.match(
    /(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i,
  );
  if (bodyMatch) return Number(bodyMatch[2]);

  const titleMatch = detail.title.match(/\(#(\d+)\)/);
  if (titleMatch) return Number(titleMatch[1]);

  const branchMatch = detail.headRef.match(/-(\d+)$/);
  if (branchMatch) return Number(branchMatch[1]);

  return null;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </h4>
  );
}

function StatePill({ pr }: { pr: PRSummary }) {
  if (pr.merged)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-300">
        <GitMerge className="h-3 w-3" /> Merged
      </span>
    );
  if (pr.state === "closed")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs font-medium text-zinc-400">
        <XCircle className="h-3 w-3" /> Closed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
      <GitPullRequest className="h-3 w-3" /> Open
    </span>
  );
}

const VERDICT_STYLES: Record<
  VerdictLevel,
  { cls: string; icon: React.ReactNode; label: string; blurb: string }
> = {
  SHIP: {
    cls: "border-emerald-700 bg-emerald-950/40 text-emerald-200",
    icon: <ShieldCheck className="h-6 w-6 text-emerald-400" />,
    label: "SHIP",
    blurb: "The reviewers say this is safe to merge.",
  },
  "FIX FIRST": {
    cls: "border-amber-700 bg-amber-950/40 text-amber-200",
    icon: <ShieldAlert className="h-6 w-6 text-amber-400" />,
    label: "FIX FIRST",
    blurb: "There's something to fix before merging.",
  },
  "DO NOT MERGE": {
    cls: "border-red-800 bg-red-950/40 text-red-200",
    icon: <ShieldX className="h-6 w-6 text-red-400" />,
    label: "DO NOT MERGE",
    blurb: "The reviewers found blocking problems.",
  },
  UNKNOWN: {
    cls: "border-zinc-700 bg-zinc-900 text-zinc-300",
    icon: <ShieldQuestion className="h-6 w-6 text-zinc-400" />,
    label: "Verdict not found",
    blurb: "Couldn't read a clear verdict from the audit.",
  },
};

function VerdictBadge({
  verdict,
  onRerun,
  busy,
}: {
  verdict: AuditVerdict;
  onRerun: () => void;
  busy: boolean;
}) {
  if (!verdict) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
        The Auditor hasn&apos;t reviewed this PR yet.
        <div>
          <RerunButton onClick={onRerun} busy={busy} label="Run audit" small />
        </div>
      </div>
    );
  }
  const s = VERDICT_STYLES[verdict.verdict];
  return (
    <div className={`rounded-xl border p-4 ${s.cls}`}>
      <div className="flex items-center gap-3">
        {s.icon}
        <div>
          <p className="text-lg font-bold leading-none">{s.label}</p>
          <p className="mt-1 text-sm opacity-90">{s.blurb}</p>
        </div>
        <a
          href={verdict.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs underline opacity-80 hover:opacity-100"
        >
          View
        </a>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium opacity-90">
          Read the full audit
        </summary>
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <Markdown>{verdict.body}</Markdown>
        </div>
      </details>
      <RerunButton onClick={onRerun} busy={busy} label="Re-run audit" small />
    </div>
  );
}
