"use client";

/**
 * "How does this project compare to the template?" — a read-only chip on the
 * map toolbar backed by GET /api/map/template/drift.
 *
 * Green when every template workflow is byte-identical in the project, amber
 * when something is behind, diverged or missing. Tapping it opens the same
 * centered modal the rest of the map uses, with a per-file breakdown and a
 * collapsible diff. Nothing here writes anything — there is deliberately no
 * "sync" button yet.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, GitCompare, X } from "lucide-react";
import Modal from "./modal";
import { PatchView } from "./diff";

type DriftStatus = "identical" | "repo-behind-or-diverged" | "missing-in-repo" | "extra-in-repo";

type DriftEntry = { file: string; status: DriftStatus; diff: string };

type Drift = {
  project: string;
  projectLabel: string;
  inSync: boolean;
  templateEmpty: boolean;
  counts: Record<DriftStatus, number>;
  files: DriftEntry[];
};

/** Plain-language wording + colour for each status. */
const STATUS: Record<
  DriftStatus,
  { label: string; note: string; pill: string; order: number }
> = {
  "repo-behind-or-diverged": {
    label: "Different from the template",
    note: "Either the template moved on since this project was created, or this file was edited here.",
    pill: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    order: 0,
  },
  "missing-in-repo": {
    label: "Missing from this project",
    note: "The template includes this agent but this project doesn't have it.",
    pill: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    order: 1,
  },
  "extra-in-repo": {
    label: "Only in this project",
    note: "An extra agent this project has and the template doesn't — usually on purpose.",
    pill: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    order: 2,
  },
  identical: {
    label: "Matches the template",
    note: "",
    pill: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    order: 3,
  },
};

/** How many files are actually out of date (extras don't count as drift). */
function outOfDate(d: Drift): number {
  return (d.counts["repo-behind-or-diverged"] ?? 0) + (d.counts["missing-in-repo"] ?? 0);
}

/**
 * The chip is decorative, so ANY response we can't fully trust means "render
 * nothing" — never a half-drawn chip and never a crash.
 *
 * The endpoint returns a bare `{ error }` on 4xx/5xx (including a 502 when
 * GitHub is unreachable), and `res.json()` is caught into `{}` when the body
 * isn't JSON at all. Both used to sail past the `!drift` guard and then blow up
 * in `outOfDate()` on `d.counts` — taking the whole Process Map down with it.
 */
function isDrift(v: unknown): v is Drift {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Partial<Drift>;
  return (
    typeof d.counts === "object" &&
    d.counts !== null &&
    Array.isArray(d.files) &&
    typeof d.inSync === "boolean"
  );
}

export default function TemplateDriftChip({ project }: { project: string }) {
  const [drift, setDrift] = useState<Drift | null>(null);
  const [open, setOpen] = useState(false);

  // One comparison per selected project — it reads GitHub, so it is not polled.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    (async () => {
      try {
        setDrift(null);
        setOpen(false);
        const res = await fetch(`/api/map/template/drift?project=${encodeURIComponent(project)}`);
        if (!res.ok) return; // 400/404/502 → no chip, nothing to say
        const j: unknown = await res.json().catch(() => null);
        if (!cancelled && isDrift(j)) setDrift(j);
      } catch {
        /* no chip on failure — this is a nice-to-have, never a blocker */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  // Nothing useful to say: still loading, failed, or there's no template yet.
  if (!drift || drift.templateEmpty) return null;

  const behind = outOfDate(drift);
  const ok = drift.inSync;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
          ok
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
            : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
        }`}
      >
        {ok ? <Check className="h-3.5 w-3.5" /> : <GitCompare className="h-3.5 w-3.5" />}
        {ok
          ? "Workflows match the template"
          : `${behind} workflow${behind === 1 ? "" : "s"} out of date vs the template`}
      </button>

      {open && <DriftModal drift={drift} onClose={() => setOpen(false)} />}
    </>
  );
}

function DriftModal({ drift, onClose }: { drift: Drift; onClose: () => void }) {
  const files = [...drift.files].sort(
    (a, b) => STATUS[a.status].order - STATUS[b.status].order || a.file.localeCompare(b.file),
  );
  const behind = outOfDate(drift);

  return (
    <Modal
      onClose={onClose}
      className="h-[95vh] w-[95vw] sm:h-auto sm:max-h-[85vh] sm:w-[90vw] sm:max-w-[720px]"
    >
      <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-3">
        <div className="leading-tight">
          <h2 className="text-base font-semibold text-zinc-100">Compared with the template</h2>
          <p className="text-[11px] text-zinc-500">
            {drift.projectLabel} vs. what a brand-new project starts with
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            drift.inSync
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }`}
        >
          {drift.inSync ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            {drift.inSync
              ? "Every agent in the template is here and identical. Nothing to do."
              : `${behind} file${behind === 1 ? " is" : "s are"} out of date. Nothing is changed from this page — it's a read-only comparison, so you can decide what (if anything) to do about it.`}
          </span>
        </div>

        <p className="text-xs leading-relaxed text-zinc-400">
          The template is the set of agents every <strong className="text-zinc-300">new</strong>{" "}
          project starts with. Existing projects drift from it over time — because the template
          was improved, or because this project&apos;s own agents were edited. Both are normal.
        </p>

        <div className="space-y-1.5">
          {files.map((f) => (
            <DriftRow key={f.file} entry={f} />
          ))}
          {files.length === 0 && (
            <p className="text-xs text-zinc-500">
              There are no agent files to compare on either side.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** One file: status, plain-English note, and its diff behind a toggle. */
function DriftRow({ entry }: { entry: DriftEntry }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS[entry.status];
  const hasDiff = entry.diff.trim() !== "";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      <button
        onClick={() => hasDiff && setOpen((v) => !v)}
        disabled={!hasDiff}
        className={`flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left ${
          hasDiff ? "transition hover:bg-zinc-800" : "cursor-default"
        }`}
      >
        {hasDiff ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          )
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="font-mono text-[11px] text-zinc-300">{entry.file}</span>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.pill}`}
        >
          {meta.label}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-800 px-3 py-2">
          {meta.note && <p className="text-[11px] text-zinc-500">{meta.note}</p>}
          <PatchView patch={entry.diff} />
          <p className="text-[10px] text-zinc-600">
            Lines marked <span className="text-red-300">-</span> are the template&apos;s version;
            lines marked <span className="text-emerald-300">+</span> are this project&apos;s.
          </p>
        </div>
      )}
    </div>
  );
}
