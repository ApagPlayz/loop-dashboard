"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, HelpCircle, MinusCircle, X } from "lucide-react";
import type { Decision, Proposal } from "@/lib/agent/types";
import { relativeTime } from "./ui";

/**
 * One row of the triage panel: what the model said about an issue, and the
 * owner's decision on it.
 *
 * The two are deliberately shown as separate things rather than as one editable
 * value. The model's verdict is a *claim* — printed once, greyed, with its
 * confidence — and the decision is the owner's, sitting underneath as four
 * explicit buttons. Nothing is preselected from the recommendation, and no
 * button is styled as "the recommended one", because the panel above this row
 * says plainly that these verdicts wobble between runs. Prefilling the owner's
 * answer with the model's would quietly undo that honesty: a screen of
 * pre-ticked boxes gets rubber-stamped.
 *
 * Skipping is a first-class choice, not a way out. `apply_decisions` treats an
 * undecided proposal as `skip` anyway, so "skip" here is the owner saying it out
 * loud rather than leaving a hole.
 */

export type DecisionAction = Decision["action"];

/** Colour vocabulary shared with idea-card.tsx's `labelBadge`. */
const VERDICT_STYLE: Record<Proposal["recommendation"], { label: string; cls: string }> = {
  approve: { label: "approve", cls: "bg-emerald-500/15 text-emerald-300" },
  decline: { label: "decline", cls: "bg-red-500/15 text-red-300" },
  "needs-info": { label: "needs info", cls: "bg-amber-500/15 text-amber-300" },
};

const CHOICES: {
  action: DecisionAction;
  label: string;
  Icon: typeof Check;
  /** Classes for the SELECTED state. Unselected is uniform zinc, on purpose. */
  on: string;
}[] = [
  { action: "approve", label: "Approve", Icon: Check, on: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-600/40" },
  { action: "decline", label: "Decline", Icon: X, on: "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-700/50" },
  { action: "needs-info", label: "Needs info", Icon: HelpCircle, on: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-700/50" },
  { action: "skip", label: "Skip", Icon: MinusCircle, on: "bg-zinc-700/50 text-zinc-200 ring-1 ring-inset ring-zinc-600" },
];

/** How sure the model claims to be, in words as well as the number. */
function confidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

export default function TriageProposalRow({
  proposal,
  decision,
  note,
  disabled,
  onDecide,
  onNote,
}: {
  proposal: Proposal;
  /** null until the owner picks something — never defaulted from the model. */
  decision: DecisionAction | null;
  note: string;
  disabled: boolean;
  onDecide: (action: DecisionAction) => void;
  onNote: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const verdict = VERDICT_STYLE[proposal.recommendation];
  const overridden = decision !== null && decision !== proposal.recommendation;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-start gap-3 p-3">
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? "Hide issue body" : "Show issue body"}
          className="mt-0.5 shrink-0 text-zinc-600 transition hover:text-zinc-300"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs tabular-nums text-zinc-500">#{proposal.number}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${verdict.cls}`}>
              model says {verdict.label}
            </span>
            <span
              className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs tabular-nums text-zinc-400"
              title={`The model's own stated confidence, 0–1. It is self-reported and not calibrated against anything — the same issue has come back at a different number on a different run.`}
            >
              conf {proposal.confidence.toFixed(2)} · {confidenceLabel(proposal.confidence)}
            </span>
            {overridden && (
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-300">
                you overrode it
              </span>
            )}
          </div>

          <p className="mt-1.5 text-sm font-medium leading-snug text-zinc-100">
            {proposal.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{proposal.reason}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-zinc-600">
            {proposal.createdAt && <span>opened {relativeTime(proposal.createdAt)}</span>}
            {proposal.labels.length > 0 && <span>{proposal.labels.join(", ")}</span>}
            {proposal.url && (
              <a
                href={proposal.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-emerald-400"
              >
                Open on GitHub <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1">
            {CHOICES.map(({ action, label, Icon, on }) => {
              const selected = decision === action;
              return (
                <button
                  key={action}
                  onClick={() => onDecide(action)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected ? on : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Only `needs-info` turns a note into anything — it becomes the
              comment body. Showing the box for the other three would promise a
              place for reasoning that nothing ever reads. */}
          {decision === "needs-info" && (
            <div className="mt-2">
              <input
                value={note}
                onChange={(e) => onNote(e.target.value)}
                disabled={disabled}
                placeholder="What's missing? This becomes the comment body (optional)"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none disabled:opacity-50"
              />
            </div>
          )}
        </div>
      </div>

      {open && proposal.body.trim() && (
        <div className="border-t border-zinc-800 px-3 py-3">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-400">
            {proposal.body}
          </pre>
        </div>
      )}
      {open && !proposal.body.trim() && (
        <div className="border-t border-zinc-800 px-3 py-3 text-xs text-zinc-600">
          No description on this issue.
        </div>
      )}
    </div>
  );
}
