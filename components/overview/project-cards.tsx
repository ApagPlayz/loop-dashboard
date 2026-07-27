"use client";

/**
 * The project-card grid on the Overview page ("/").
 *
 * A small client island inside an otherwise server-rendered page: the cards
 * need `setProject()` from the global project context so that clicking one
 * switches the whole dashboard's scope (cookie + router.refresh(), which also
 * re-renders the KPI row above with the newly selected project's numbers).
 *
 * Styled with the new navy design tokens (see globals.css).
 */

import { Check } from "lucide-react";
import { useProject } from "@/components/project-context";
import type { ProjectSnapshot, ProjectStatus } from "@/lib/overview";

const STATUS: Record<
  ProjectStatus,
  { label: string; className: string; dot: string }
> = {
  building: {
    label: "Building",
    className: "border-ds-accent/40 bg-ds-accent/10 text-ds-accent",
    dot: "bg-ds-accent",
  },
  active: {
    label: "Active",
    className: "border-ds-accent/25 bg-ds-accent/5 text-ds-accent/90",
    dot: "bg-ds-accent/70",
  },
  idle: {
    label: "Idle",
    className: "border-ds-border bg-ds-panel-2 text-ds-muted",
    dot: "bg-ds-faint",
  },
  "needs-setup": {
    label: "Needs setup",
    className: "border-ds-warning/40 bg-ds-warning/10 text-ds-warning",
    dot: "bg-ds-warning",
  },
};

export function StatusPill({
  status,
  unreachable,
}: {
  status: ProjectStatus;
  unreachable?: boolean;
}) {
  const tone = unreachable
    ? {
        label: "Unreachable",
        className: "border-ds-danger/40 bg-ds-danger/10 text-ds-danger",
        dot: "bg-ds-danger",
      }
    : STATUS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-ds-label ${tone.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}

export default function ProjectCards({
  snapshots,
}: {
  snapshots: ProjectSnapshot[];
}) {
  const { project, setProject } = useProject();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {snapshots.map((s) => {
        const selected = s.key === project;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => setProject(s.key)}
            aria-pressed={selected}
            className={`rounded-xl border p-4 text-left transition ${
              selected
                ? "border-ds-accent/40 bg-ds-panel-2"
                : "border-ds-border bg-ds-panel hover:border-ds-accent/25 hover:bg-ds-panel-2"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-ds-heading text-ds-text">
                  {s.label}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-ds-faint">
                  {s.owner}/{s.repo}
                </p>
              </div>
              <StatusPill status={s.status} unreachable={s.unreachable} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Count label="ideas" value={s.openIdeas} />
              <Count label="PRs" value={s.openPRs} accent={s.openPRs > 0} />
              <Count label="agents" value={s.agents} />
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ds-faint">
              {selected && <Check className="h-3 w-3 text-ds-accent" />}
              {selected
                ? "Current project"
                : s.unreachable
                  ? "Couldn't read this repo"
                  : "Switch to this project"}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function Count({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded-lg border px-2 py-1 text-[11px] ${
        accent
          ? "border-ds-accent/25 bg-ds-accent/10 text-ds-accent"
          : "border-ds-border bg-ds-panel-2 text-ds-muted"
      }`}
    >
      <span className="text-sm font-semibold tabular-nums tracking-ds-heading">
        {value}
      </span>
      {label}
    </span>
  );
}
