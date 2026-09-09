"use client";

/**
 * "Can this loop actually run?" — the preflight sweep, backed by
 * GET/POST /api/map/health.
 *
 * The question this answers is deliberately narrower than "is the loop
 * healthy": it is *can the agents fire at all*. A project can look perfectly
 * fine on the map — every agent node drawn, every workflow file present — and
 * still be completely dead because the repo has no CLAUDE_CODE_OAUTH_TOKEN, or
 * because GitHub switched seven of its eight workflows off. That is exactly
 * what happened to supply-chain-optimizer, and the only way to find out was to
 * open a setup wizard and read a checklist. This chip exists so that never
 * happens again.
 *
 * Cross-project on purpose. The map is scoped to one project, but "which of my
 * loops is dead" is a question about all of them, and the endpoint returns all
 * of them, so the chip summarises the worst verdict across the registry and the
 * modal lists every project (worst first, the selected one pinned to the top of
 * its group).
 *
 * Read-mostly, like the template-drift panel next to it: the only writes are
 * the two fixes GitHub's API can genuinely perform — re-enabling workflows and
 * re-running a failed run. Everything else says plainly that it needs a browser
 * rather than offering a button that can't work.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  GitCompare,
  HelpCircle,
  KeyRound,
  Loader2,
  Power,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import Modal from "./modal";
import { relativeTime } from "./format";
import { useProject } from "@/components/project-context";
import type {
  LoopFault,
  LoopHealth,
  LoopHealthPayload,
  LoopVerdict,
} from "@/lib/loop-health";

/* ------------------------------------------------------------------ */
/* Verdict vocabulary                                                  */
/* ------------------------------------------------------------------ */

/**
 * One place where each verdict's colour, icon and wording is decided.
 *
 * The two rules this table encodes:
 *  - `blocked` is the only loud one. It means the loop cannot run at all, so it
 *    gets the red the rest of the app reserves for real errors.
 *  - `unknown` must never read as a pass. A check that couldn't run is not a
 *    green tick, so it gets its own treatment — a dashed border and a question
 *    mark, deliberately unlike `healthy`'s solid border and emerald tick —
 *    plus a sentence saying so in as many words.
 *
 * `healthy` is intentionally the quietest row on screen: nothing to do here.
 */
const VERDICT: Record<
  LoopVerdict,
  {
    /** Worst-first ordering for both the summary chip and the list. */
    rank: number;
    /** Short label for the pill on each project card. */
    label: string;
    /** One line under the project name. */
    blurb: string;
    Icon: LucideIcon;
    /** Icon tint. */
    icon: string;
    /** The pill next to the project name. */
    pill: string;
    /** The project card itself. */
    card: string;
    /** The toolbar chip, when this is the worst verdict in the sweep. */
    chip: string;
  }
> = {
  blocked: {
    rank: 0,
    label: "Can't run",
    blurb: "Something here stops every agent from running. Nothing in this loop will fire until it's fixed.",
    Icon: ShieldAlert,
    icon: "text-red-400",
    pill: "border-red-500/40 bg-red-500/10 text-red-300",
    card: "border-red-500/40 bg-red-500/5",
    chip: "border-red-500/50 bg-red-500/15 text-red-300 hover:bg-red-500/25",
  },
  degraded: {
    rank: 1,
    label: "Partly working",
    blurb: "The loop can run, but part of it is switched off, failing or out of date.",
    Icon: AlertTriangle,
    icon: "text-amber-400",
    pill: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    card: "border-amber-500/40 bg-amber-500/5",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20",
  },
  unknown: {
    rank: 2,
    label: "Not checked",
    blurb: "One or more checks couldn't run, so we don't know whether this loop works. This is not a pass.",
    Icon: HelpCircle,
    icon: "text-zinc-400",
    pill: "border-dashed border-zinc-600 bg-zinc-800/60 text-zinc-300",
    card: "border-dashed border-zinc-600 bg-zinc-900/40",
    chip: "border-dashed border-zinc-600 bg-zinc-900 text-zinc-400 hover:bg-zinc-800",
  },
  healthy: {
    rank: 3,
    label: "Ready",
    blurb: "Token set, workflows on, recent runs passing. Nothing to do.",
    Icon: Check,
    icon: "text-emerald-400",
    pill: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    card: "border-zinc-800 bg-zinc-900",
    chip: "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800",
  },
};

const VERDICTS: LoopVerdict[] = ["blocked", "degraded", "unknown", "healthy"];

const CHIP_BASE =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition";

/** "1 loop" / "3 loops". */
function loops(n: number): string {
  return `${n} loop${n === 1 ? "" : "s"}`;
}

/** Wording for the toolbar chip once a sweep has landed. */
function chipLabel(worst: LoopVerdict, counts: Record<LoopVerdict, number>): string {
  switch (worst) {
    case "blocked":
      return `${loops(counts.blocked)} can't run`;
    case "degraded":
      return `${loops(counts.degraded)} need${counts.degraded === 1 ? "s" : ""} attention`;
    case "unknown":
      return `${loops(counts.unknown)} couldn't be checked`;
    default:
      return counts.healthy === 1 ? "Loop ready to run" : `All ${counts.healthy} loops ready`;
  }
}

/**
 * A malformed payload must never be rendered as "everything's fine" — the
 * whole point of this panel is that silence is not a pass. Anything that
 * doesn't look like the contract is treated as a failed sweep instead.
 */
function isPayload(v: unknown): v is LoopHealthPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Partial<LoopHealthPayload>;
  return Array.isArray(p.projects);
}


/* ------------------------------------------------------------------ */
/* Chip + sweep                                                        */
/* ------------------------------------------------------------------ */

export default function LoopPreflightChip({
  onCompareTemplate,
}: {
  /**
   * Open the existing template-drift panel for the *selected* project. The
   * drift fault links to that panel rather than duplicating its diff view.
   */
  onCompareTemplate: () => void;
}) {
  const [payload, setPayload] = useState<LoopHealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false);

  const sweep = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/map/health");
      const j: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (j as { error?: string } | null)?.error;
        throw new Error(msg ?? "Couldn't run the preflight checks.");
      }
      if (!isPayload(j)) throw new Error("The preflight checks came back in a shape we don't understand.");
      setPayload(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run the preflight checks.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // One sweep on mount. It reads GitHub for every registered project, so it
    // is never polled — refreshing is an explicit "Check again".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    sweep();
  }, [sweep]);

  const projects = payload?.projects ?? [];
  const counts = VERDICTS.reduce(
    (acc, v) => {
      acc[v] = projects.filter((p) => p.verdict === v).length;
      return acc;
    },
    { blocked: 0, degraded: 0, unknown: 0, healthy: 0 } as Record<LoopVerdict, number>,
  );
  const worst = VERDICTS.find((v) => counts[v] > 0) ?? null;

  // First sweep still in flight: say so rather than showing nothing. A slow
  // sweep (it walks every repo on GitHub) must not look like a broken chip.
  if (!payload && checking) {
    return (
      <span className={`${CHIP_BASE} cursor-default border-zinc-800 bg-zinc-900/60 text-zinc-400`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking every loop…
      </span>
    );
  }

  // The sweep itself failed. That is an unknown, not a pass, so it keeps the
  // unknown styling and still opens — the modal carries the actual error.
  const failed = !payload;
  const empty = !failed && projects.length === 0;
  // "All clear" is the only state that earns the emerald tick, and it stays a
  // plain zinc chip — a good result should not shout louder than a bad one.
  const allClear = !failed && !empty && worst === "healthy";
  const style = failed || empty ? VERDICT.unknown.chip : VERDICT[worst ?? "healthy"].chip;
  const Icon = failed || empty ? HelpCircle : VERDICT[worst ?? "healthy"].Icon;

  return (
    <>
      <button onClick={() => setOpen(true)} className={`${CHIP_BASE} ${style}`}>
        <Icon className={`h-3.5 w-3.5 ${allClear ? "text-emerald-400" : ""}`} />
        {failed
          ? "Preflight didn't run"
          : empty
            ? "No loops to check"
            : chipLabel(worst ?? "healthy", counts)}
      </button>

      {open && (
        <PreflightModal
          payload={payload}
          error={error}
          checking={checking}
          onRecheck={sweep}
          onClose={() => setOpen(false)}
          onCompareTemplate={() => {
            setOpen(false);
            onCompareTemplate();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

function PreflightModal({
  payload,
  error,
  checking,
  onRecheck,
  onClose,
  onCompareTemplate,
}: {
  payload: LoopHealthPayload | null;
  error: string | null;
  checking: boolean;
  onRecheck: () => Promise<void>;
  onClose: () => void;
  onCompareTemplate: () => void;
}) {
  const { project: selected, setProject } = useProject();
  const projects = payload?.projects ?? [];

  // Worst first, then the project you're looking at, then alphabetically —
  // so the thing that needs you is always at the top of the list.
  const ordered = [...projects].sort(
    (a, b) =>
      VERDICT[a.verdict].rank - VERDICT[b.verdict].rank ||
      Number(b.projectKey === selected) - Number(a.projectKey === selected) ||
      a.label.localeCompare(b.label),
  );

  return (
    <Modal
      onClose={onClose}
      className="h-[95vh] w-[95vw] sm:h-auto sm:max-h-[85vh] sm:w-[90vw] sm:max-w-[720px]"
    >
      <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-3">
        <div className="leading-tight">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <ShieldCheck className="h-4 w-4 text-emerald-400" /> Loop preflight
          </h2>
          <p className="text-[11px] text-zinc-500">
            Can each project actually run its Claude agents?
            {payload?.checkedAt && ` · checked ${relativeTime(payload.checkedAt)}`}
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

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {error} Nothing below is a pass — the checks didn&apos;t finish, so we can&apos;t tell
              you whether these loops work.
            </span>
          </div>
        )}

        {checking && (
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading GitHub for every project — this
            takes a few seconds.
          </p>
        )}

        {!checking && !error && projects.length === 0 && (
          <p className="text-xs text-zinc-500">
            No projects are registered yet, so there is nothing to preflight. Add one from the
            project switcher and it will show up here.
          </p>
        )}

        {ordered.map((h) => (
          <ProjectHealthCard
            key={h.projectKey}
            health={h}
            isSelected={h.projectKey === selected}
            onFixed={onRecheck}
            onCompareTemplate={onCompareTemplate}
            onSelectProject={setProject}
          />
        ))}

        <button
          disabled={checking}
          onClick={() => void onRecheck()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Check again
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* One project                                                         */
/* ------------------------------------------------------------------ */

function ProjectHealthCard({
  health,
  isSelected,
  onFixed,
  onCompareTemplate,
  onSelectProject,
}: {
  health: LoopHealth;
  isSelected: boolean;
  onFixed: () => Promise<void>;
  onCompareTemplate: () => void;
  onSelectProject: (key: string) => void;
}) {
  const meta = VERDICT[health.verdict];
  const { Icon } = meta;

  return (
    <div className={`rounded-lg border p-3.5 ${meta.card}`}>
      <div className="flex flex-wrap items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.icon}`} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">
            {health.label}
            {isSelected && (
              <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                on screen now
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">
            {health.owner}/{health.repo}
          </p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.pill}`}>
          {meta.label}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{meta.blurb}</p>

      {/* Evidence, not a claim: a real successful run is the only thing that
          proves the Claude GitHub app is actually installed on this repo. */}
      {health.appProof.proven && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-emerald-300/90">
          <Check className="h-3 w-3 shrink-0" />
          Claude GitHub app confirmed by a successful run
          {health.appProof.at && ` on ${formatDay(health.appProof.at)}`}
          {health.appProof.runUrl && (
            <a
              className="inline-flex items-center gap-0.5 underline hover:text-emerald-200"
              href={health.appProof.runUrl}
              target="_blank"
              rel="noreferrer"
            >
              view it <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </p>
      )}

      {health.faults.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {health.faults.map((f, i) => (
            <FaultRow
              key={`${f.kind}-${i}`}
              health={health}
              fault={f}
              isSelected={isSelected}
              onFixed={onFixed}
              onCompareTemplate={onCompareTemplate}
              onSelectProject={onSelectProject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** "4 Mar 2026" — only ever called client-side, after a fetch. */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an earlier run";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* ------------------------------------------------------------------ */
/* One fault                                                           */
/* ------------------------------------------------------------------ */

/** Shell for a single fault: icon, plain-English headline, then the remedy. */
function FaultShell({
  Icon,
  tint,
  title,
  children,
}: {
  Icon: LucideIcon;
  tint: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="flex items-start gap-2 text-sm font-medium text-zinc-200">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tint}`} />
        {title}
      </p>
      <div className="mt-1.5 space-y-2 pl-6 text-xs leading-relaxed text-zinc-400">{children}</div>
    </div>
  );
}

/** A "no button here, and here's why" line — honest beats a dead control. */
function NoOneClick({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-zinc-500">{children}</p>;
}

function ExternalAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function FaultRow({
  health,
  fault,
  isSelected,
  onFixed,
  onCompareTemplate,
  onSelectProject,
}: {
  health: LoopHealth;
  fault: LoopFault;
  isSelected: boolean;
  onFixed: () => Promise<void>;
  onCompareTemplate: () => void;
  onSelectProject: (key: string) => void;
}) {
  const repoUrl = `https://github.com/${health.owner}/${health.repo}`;

  switch (fault.kind) {
    case "missing-token":
      return (
        <FaultShell
          Icon={KeyRound}
          tint="text-red-400"
          title="The Claude login token isn't set — no agent can run"
        >
          <p>
            Every workflow in this repo signs in with a secret called{" "}
            <code className="rounded bg-zinc-800 px-1 text-[11px] text-zinc-300">
              CLAUDE_CODE_OAUTH_TOKEN
            </code>
            . Without it the workflows still trigger, they just fail immediately — which is why the
            map can look completely normal while nothing works.
          </p>
          <NoOneClick>
            There is no one-click fix for this one: minting the token needs a browser sign-in (
            <code className="rounded bg-zinc-800 px-1 text-[11px] text-zinc-300">
              claude setup-token
            </code>{" "}
            on your own machine), and the dashboard can&apos;t do that for you.
          </NoOneClick>
          <ExternalAction href={`${repoUrl}/settings/secrets/actions`}>
            Open this repo&apos;s Actions secrets
          </ExternalAction>
        </FaultShell>
      );

    case "workflows-disabled":
      return (
        <FaultShell
          Icon={Power}
          tint="text-amber-400"
          title={`${fault.files.length} workflow${fault.files.length === 1 ? " is" : "s are"} switched off on GitHub`}
        >
          <p>
            These are installed but disabled, so they will never fire — no schedule, no trigger,
            nothing:
          </p>
          <ul className="space-y-0.5">
            {fault.files.map((file, i) => (
              <li key={file} className="text-zinc-300">
                {fault.names[i] ?? file}{" "}
                <span className="font-mono text-[10px] text-zinc-500">{file}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-zinc-500">
            Turning them back on switches on every file listed above — if you disabled one of them
            deliberately, use the Power menu to flip them individually instead.
          </p>
          <FixButton
            project={health.projectKey}
            body={{ action: "enable-workflows", files: fault.files }}
            label="Turn these back on"
            busyLabel="Turning them on…"
            doneLabel="Switched back on"
            Icon={Power}
            onDone={onFixed}
          />
        </FaultShell>
      );

    case "runs-failing": {
      const runId = fault.lastRunId;
      return (
        <FaultShell
          Icon={AlertTriangle}
          tint="text-amber-400"
          title={`${fault.workflowName} has failed ${fault.streak} run${fault.streak === 1 ? "" : "s"} in a row`}
        >
          <p>
            It is installed and switched on, but the last {fault.streak} attempt
            {fault.streak === 1 ? "" : "s"} ended in failure — so this part of the loop is not
            really running. The run log says which step broke.
          </p>
          <p className="font-mono text-[10px] text-zinc-500">{fault.workflowFile}</p>
          <div className="flex flex-wrap gap-2">
            <ExternalAction href={fault.lastRunUrl}>View the failed run</ExternalAction>
            {runId !== null ? (
              <FixButton
                project={health.projectKey}
                body={{ action: "rerun", runId }}
                label="Re-run it"
                busyLabel="Starting the re-run…"
                doneLabel="Re-run started"
                Icon={RotateCw}
                onDone={onFixed}
              />
            ) : (
              <NoOneClick>
                GitHub didn&apos;t give us an id for that run, so there&apos;s no re-run button here
                — start it from the run page instead.
              </NoOneClick>
            )}
          </div>
        </FaultShell>
      );
    }

    case "template-drift":
      return (
        <FaultShell
          Icon={GitCompare}
          tint="text-amber-400"
          title={`${fault.files.length} workflow file${fault.files.length === 1 ? "" : "s"} differ from the template`}
        >
          <p>
            Not necessarily wrong — the template may have moved on since this project was created,
            or these files were edited here on purpose. Worth a look either way:
          </p>
          <ul className="space-y-0.5 font-mono text-[10px] text-zinc-400">
            {fault.files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {/* Deliberately no diff here — "Compared with the template" already
              renders the per-file diff, so this links to it rather than
              growing a second copy that can drift from the first. */}
          {isSelected ? (
            <button
              onClick={onCompareTemplate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              <GitCompare className="h-3.5 w-3.5" /> See the differences
            </button>
          ) : (
            <button
              onClick={() => onSelectProject(health.projectKey)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              <GitCompare className="h-3.5 w-3.5" /> Switch to {health.label} to compare
            </button>
          )}
        </FaultShell>
      );

    case "app-unproven":
      return (
        <FaultShell
          Icon={HelpCircle}
          tint="text-zinc-400"
          title="No agent run has ever succeeded here"
        >
          <p>
            So we can&apos;t confirm the Claude GitHub app is installed on this repo. That is not
            proof it is missing — only that nothing has ever proved it is there. Check the app
            covers <span className="font-mono text-[10px]">{health.repo}</span>, then run any agent
            once and this turns into a confirmation.
          </p>
          <ExternalAction href="https://github.com/apps/claude">
            Open the Claude GitHub app
          </ExternalAction>
        </FaultShell>
      );

    case "check-failed":
      return (
        <FaultShell
          Icon={HelpCircle}
          tint="text-zinc-400"
          title={`Couldn't check: ${fault.what}`}
        >
          <p className="text-zinc-300">{fault.detail}</p>
          <NoOneClick>
            This is <strong className="text-zinc-400">not</strong> a pass — that part of the
            preflight simply didn&apos;t run, so this project&apos;s verdict is missing information.
            &ldquo;Check again&rdquo; below retries it.
          </NoOneClick>
        </FaultShell>
      );
  }
}

/* ------------------------------------------------------------------ */
/* One-click fixes                                                     */
/* ------------------------------------------------------------------ */

/**
 * A fix button with all three of the states a write needs: pending, failed
 * (showing what the server actually said, never a swallowed error) and done
 * (which re-runs the sweep, so the row either disappears or comes back with a
 * different fault — the panel never claims success it hasn't re-verified).
 */
function FixButton({
  project,
  body,
  label,
  busyLabel,
  doneLabel,
  Icon,
  onDone,
}: {
  project: string;
  body: Record<string, unknown>;
  label: string;
  busyLabel: string;
  doneLabel: string;
  Icon: LucideIcon;
  onDone: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/map/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, ...body }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "That didn't work.");
      setState("done");
      // Re-read the truth from GitHub rather than trusting the button.
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
      setState("idle");
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        disabled={state !== "idle"}
        onClick={() => void run()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
      >
        {state === "busy" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === "done" ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
        {state === "busy" ? busyLabel : state === "done" ? doneLabel : label}
      </button>
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}
