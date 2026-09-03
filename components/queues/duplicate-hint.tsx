"use client";

import { ExternalLink, Files } from "lucide-react";
import type { DuplicateMatch, DuplicateReport } from "@/lib/dedup/queue-duplicates";
import { relativeTime } from "./ui";

/**
 * The near-duplicate strip on an idea card, and the one-line summary above the
 * tabs.
 *
 * Both are pure decoration over `IdeasPayload.duplicates`, which is `null`
 * whenever the embedding index is unavailable — so both render nothing at all
 * rather than an error state, and the Ideas screen is identical to what it was
 * before this file existed.
 *
 * The strip lives OUTSIDE the card's header button on purpose: the header is a
 * `<button>` that toggles the card, and a link nested inside it would be
 * invalid markup and unclickable. Putting it directly below means the owner
 * sees the duplicate — with the number, the title, the score and a working link
 * — without expanding anything, which is the whole point.
 */

/** Human name for the encoder behind a score, so "0.862" means something. */
function methodLabel(method: DuplicateReport["method"]): string {
  return method === "dense_titan" ? "Titan v2" : "MiniLM-L6";
}

/**
 * The sentence that makes the threshold legible. Written out in the tooltip
 * rather than left as a bare number, because "0.842" on its own is exactly the
 * kind of unexplained figure that gets "fixed" by the next person to read it.
 */
function thresholdTooltip(report: DuplicateReport): string {
  const source =
    report.thresholdSource === "metrics"
      ? "read from metrics/dedup-eval.json"
      : "built-in fallback (metrics/dedup-eval.json unreadable)";
  return (
    `Cosine similarity between ${methodLabel(report.method)} embeddings of the two issues. ` +
    `Anything at or above ${report.threshold} is flagged — the precision-first operating point ` +
    `swept for ${report.method} on a 150-pair labelled set (${source}). ` +
    `At that threshold the sweep measured precision 0.909 and recall 0.800 for Titan, ` +
    `0.950 / 0.760 for MiniLM; both were tuned on the data they were scored on, so treat ` +
    `them as optimistic.`
  );
}

export function DuplicateStrip({
  matches,
  report,
}: {
  matches: DuplicateMatch[];
  report: DuplicateReport;
}) {
  if (matches.length === 0) return null;

  return (
    <div className="border-t border-violet-500/20 bg-violet-500/[0.06] px-4 py-3">
      <div className="flex items-center gap-1.5">
        <Files className="h-3.5 w-3.5 text-violet-300" />
        <span className="text-xs font-semibold uppercase tracking-wide text-violet-300">
          {matches.length === 1 ? "Possible duplicate" : "Possible duplicates"}
        </span>
      </div>

      <ul className="mt-2 space-y-1.5">
        {matches.map((match) => (
          <li key={match.number}>
            <a
              href={match.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-2 rounded-lg px-1.5 py-1 -mx-1.5 transition hover:bg-violet-500/10"
            >
              <span className="shrink-0 pt-px text-xs tabular-nums text-zinc-500 group-hover:text-violet-300">
                #{match.number}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-snug text-zinc-300 group-hover:text-zinc-100">
                {match.title}
              </span>
              <span
                className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium tabular-nums text-violet-200"
                title={thresholdTooltip(report)}
              >
                {match.score.toFixed(3)}
              </span>
              <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-zinc-600 group-hover:text-violet-300" />
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-zinc-500" title={thresholdTooltip(report)}>
        Similarity ≥ {report.threshold} · {methodLabel(report.method)} embeddings · index built{" "}
        {relativeTime(report.indexBuiltAt)}
      </p>
    </div>
  );
}

/**
 * One line above the tabs saying how much of the queue was actually checked.
 *
 * This exists so a STALE index is visible rather than implied. An idea filed
 * after the last `scripts/ml/build-index.mjs` run has no vector, so it can
 * neither match nor be matched — and "no duplicates found" for an issue that
 * was never scored is the single most misleading thing this feature could say.
 */
export function DuplicateSummary({ report }: { report: DuplicateReport | null }) {
  if (!report) return null;

  const flagged = Object.keys(report.pairs).length;
  const stale = report.unindexed.length;

  return (
    <span className="text-xs text-zinc-500" title={thresholdTooltip(report)}>
      Duplicate check:{" "}
      <span className={flagged > 0 ? "text-violet-300" : "text-zinc-300"}>
        {flagged === 0 ? "none flagged" : `${flagged} flagged`}
      </span>{" "}
      · {report.scored} scored
      {stale > 0 && (
        <span
          title={`Filed after the embedding index was built, so they were not checked: ${report.unindexed
            .map((n) => `#${n}`)
            .join(", ")}. Re-run scripts/ml/build-index.mjs to include them.`}
        >
          {" "}
          · <span className="text-amber-300">{stale} not in the index</span>
        </span>
      )}
    </span>
  );
}
