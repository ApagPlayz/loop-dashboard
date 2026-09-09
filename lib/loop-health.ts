/**
 * Loop preflight — "can this loop actually run, and if not, exactly why?"
 *
 * ## Why this exists
 *
 * Everything that tells the owner a loop is broken is currently *per-project
 * and buried*. The setup checklist knows whether `CLAUDE_CODE_OAUTH_TOKEN` is
 * present, the power menu knows which workflows are switched off, the drift
 * endpoint knows the workflows have gone stale — but each lives behind its own
 * screen, for one project at a time. So the real failure mode looks like this:
 * a repo has its workflows installed, no token secret, and seven of its eight
 * agents `disabled_manually`, and nothing anywhere says so until the owner
 * happens to open that project's wizard. This module answers the question for
 * EVERY registered project at once, in a single shape the UI can render as a
 * board.
 *
 * ## The one hard rule: no model, no Claude token, ever
 *
 * This layer must never call a model and must never depend on
 * `CLAUDE_CODE_OAUTH_TOKEN`. An agent that needs the token cannot diagnose a
 * missing token — the diagnosis would fail for exactly the reason it is meant
 * to report, and the owner would get a spinner instead of an answer. Plain
 * TypeScript over the dashboard's existing `GITHUB_TOKEN` Octokit client is
 * the whole implementation, deliberately.
 *
 * ## The second hard rule: never say "healthy" because a check errored
 *
 * `lib/loop-template.ts` already learned this one the expensive way — a
 * rate-limit blip made drift "cry wolf", and the fix was to throw rather than
 * report a state we hadn't actually established. Same precedent here, in the
 * other direction: a check that could not be performed produces a
 * `check-failed` fault and an `unknown` verdict. It never silently collapses
 * into "no faults found". The three-state secret check
 * (`app/api/map/projects/checklist/route.ts`) is the model: `true` / `false` /
 * `null`, where `null` means "the PAT wasn't allowed to look", NOT "the secret
 * is missing".
 *
 * ## Nothing here repairs anything
 *
 * Every function in this file is read-only. The one-click repairs live behind
 * an explicit POST in `app/api/map/health/route.ts` and are never triggered by
 * a check.
 *
 * ## Composition, not reimplementation
 *
 * Each signal comes from the module that already owns it:
 *   - secret presence  → `octokit.rest.actions.listRepoSecrets` (names only),
 *                        same call and same three-state handling as the checklist route
 *   - workflow on/off  → `listLoopWorkflows` (lib/map-power.ts)
 *   - template drift   → `computeTemplateDrift` (lib/loop-template.ts)
 *   - run history      → `getWorkflowRuns` (lib/github.ts)
 */

import {
  getOctokit,
  getWorkflowRuns,
  type RepoConfig,
} from "./github";
import { listLoopWorkflows, type WorkflowPower } from "./map-power";
import { computeTemplateDrift, type TemplateDrift } from "./loop-template";
import { listProjects, type Project } from "./projects";

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

export type LoopFault =
  | { kind: "missing-token" }
  | { kind: "workflows-disabled"; files: string[]; names: string[] }
  | {
      kind: "runs-failing";
      workflowFile: string;
      workflowName: string;
      streak: number;
      lastRunUrl: string;
      /**
       * The run's own id, carried alongside the URL so the "re-run it" repair
       * has something to POST. The UI used to recover this by regexing the id
       * back out of `lastRunUrl`, which meant a GitHub URL-shape change would
       * silently hide the button. `null` when the id was unreadable — callers
       * must treat that as "no re-run available", not as a missing run.
       */
      lastRunId: number | null;
    }
  | { kind: "template-drift"; files: string[] }
  | { kind: "app-unproven" }
  | { kind: "check-failed"; what: string; detail: string };

export type LoopVerdict = "healthy" | "degraded" | "blocked" | "unknown";

export type AppProof = { proven: boolean; runUrl: string | null; at: string | null };

export type LoopHealth = {
  projectKey: string;
  label: string;
  owner: string;
  repo: string;
  verdict: LoopVerdict;
  faults: LoopFault[];
  appProof: AppProof;
  checkedAt: string;
};

export type LoopHealthPayload = { projects: LoopHealth[]; checkedAt: string };

/* ------------------------------------------------------------------ */
/* Probe: the raw, un-judged readings for one project                  */
/* ------------------------------------------------------------------ */

/** One workflow run, trimmed to the fields a verdict actually needs. */
export type RunSummary = {
  id: number;
  /** Workflow filename, e.g. "claude-scout.yml" — matches `WorkflowPower.file`. */
  workflowFile: string;
  workflowName: string;
  /** GitHub run status: "completed", "in_progress", "queued", … */
  status: string | null;
  /** GitHub run conclusion: "success", "failure", … `null` while still running. */
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
};

/**
 * Everything we managed to read about one project, with "couldn't read it"
 * kept distinct from "read it, and the answer is no" at every single field.
 * The judging step ({@link deriveHealth}) is a pure function of this, which is
 * what makes the verdict rules testable without a network.
 */
export type LoopProbe = {
  /**
   * Is `CLAUDE_CODE_OAUTH_TOKEN` in the repo's Actions secrets?
   * `null` = the PAT could not list secrets. This is the three-state value the
   * checklist route established; collapsing `null` into `false` would report a
   * missing token to an owner whose token is fine, which is the single most
   * misleading thing this board could do.
   */
  secret: boolean | null;
  /** Loop workflows and their on/off state; `null` when the listing failed. */
  workflows: WorkflowPower[] | null;
  /** Recent runs per workflow filename, most-recent-first; `null` when unreadable. */
  runs: Map<string, RunSummary[]> | null;
  /** Template comparison; `null` when it could not be computed. */
  drift: TemplateDrift | null;
  /**
   * Checks that could not be performed at all. Each becomes a `check-failed`
   * fault and forces the verdict away from `healthy`.
   */
  failures: { what: string; detail: string }[];
};

/* ------------------------------------------------------------------ */
/* Failure streaks                                                     */
/* ------------------------------------------------------------------ */

/**
 * Conclusions that mean the agent tried and did not work.
 *
 * `timed_out` and `startup_failure` are here because both are indistinguishable
 * from a plain failure as far as "the loop is not producing anything" goes —
 * a startup failure is in fact the classic symptom of a MISSING token, since
 * the job dies before the agent step runs.
 */
const FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

/**
 * Count consecutive failures from the most recent run backwards.
 *
 * Three deliberate decisions, because the existing code only ever looked at the
 * single latest run and this is the first thing here with real judgement in it:
 *
 * 1. **Unfinished runs are skipped, not counted.** A run that is still
 *    `in_progress` (conclusion `null`) has not concluded anything. Counting it
 *    either way would make the streak flicker while an agent is working.
 *
 * 2. **`cancelled` and `skipped` are NEUTRAL — they break neither the streak
 *    nor the success.** They are scanned past and the walk continues to the run
 *    behind them. A cancelled run is usually a human hitting the button or a
 *    concurrency-group supersede; a skipped one is a path/if filter that
 *    declined to run. Neither is evidence the agent works, so it must not clear
 *    a real streak; neither is evidence it is broken, so it must not extend one.
 *    `neutral`, `stale` and `action_required` are treated the same way, for the
 *    same reason — none of them means "the agent ran and failed".
 *
 * 3. **A streak of one is not reported.** One red run is noise: a flaky
 *    network, a transient GitHub incident, a single bad prompt. The caller only
 *    raises a fault at 2+. Two in a row is a pattern.
 */
export function countFailureStreak(runs: RunSummary[]): number {
  let streak = 0;
  for (const run of runs) {
    if (run.status !== "completed" || run.conclusion === null) continue; // still running
    if (FAILURE_CONCLUSIONS.has(run.conclusion)) {
      streak++;
      continue;
    }
    if (run.conclusion === "success") return streak; // the streak ends here
    // cancelled / skipped / neutral / stale / action_required — say nothing, keep walking.
  }
  return streak;
}

/* ------------------------------------------------------------------ */
/* App proof                                                           */
/* ------------------------------------------------------------------ */

/** Is this a loop agent workflow (as opposed to loop-metrics.yml or repo CI)? */
export function isClaudeWorkflowFile(file: string): boolean {
  return /^claude-.*\.ya?ml$/.test(file);
}

/**
 * Whether the Claude GitHub App is installed on this repo — derived, because it
 * cannot be asked.
 *
 * A fine-grained PAT cannot call the Apps API: `/repos/{o}/{r}/installation`
 * answers 401 and `/user/installations` answers 403 (both verified). That is
 * why `app: "unknown"` is hardcoded in the checklist route. But there is a
 * perfectly good proxy sitting in the run history: a claude-* workflow run that
 * COMPLETED SUCCESSFULLY could only have done so with the app installed and the
 * token working. So a green run is proof.
 *
 * Read the tense carefully, and say it in the UI too: this proves the app
 * worked **at that moment**, not that it works now. An install revoked five
 * minutes ago still leaves last week's green run behind. It is evidence, and
 * the strongest evidence this token can obtain — it is not a live check.
 *
 * The absence of any green run is a much weaker signal, which is why the caller
 * only turns it into a fault when the run history was actually readable.
 */
export function deriveAppProof(runs: RunSummary[]): AppProof {
  let best: RunSummary | null = null;
  for (const run of runs) {
    if (!isClaudeWorkflowFile(run.workflowFile)) continue;
    if (run.conclusion !== "success") continue;
    if (best === null || run.createdAt > best.createdAt) best = run;
  }
  if (!best) return { proven: false, runUrl: null, at: null };
  return { proven: true, runUrl: best.htmlUrl, at: best.createdAt };
}

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

/** Only these two faults mean the loop genuinely CANNOT run. */
function isBlocking(fault: LoopFault, claudeCount: number, disabledCount: number): boolean {
  if (fault.kind === "missing-token") return true;
  // "Some workflows off" is degraded; "every agent off" is the loop switched off.
  return (
    fault.kind === "workflows-disabled" && claudeCount > 0 && disabledCount === claudeCount
  );
}

/**
 * Turn one project's readings into a verdict.
 *
 * **The rules, in precedence order:**
 *
 * - `blocked`  — the loop CANNOT run at all. Either `CLAUDE_CODE_OAUTH_TOKEN`
 *                is confirmed absent, or every claude-* workflow is disabled.
 *                This outranks `unknown` on purpose: a definite, actionable,
 *                run-preventing fact stays the headline even when some *other*
 *                check also failed. (It can only ever be reached by a check
 *                that succeeded, so it never rests on a guess.)
 * - `unknown`   — nothing blocking was established, but at least one check
 *                could not be performed. Never `healthy`, never `degraded`:
 *                we do not know, and the `check-failed` fault says which part.
 * - `degraded`  — every check ran, the loop can run, but something is wrong:
 *                some (not all) workflows disabled, a failure streak, template
 *                drift, or no run has ever proved the GitHub App.
 * - `healthy`   — every check ran and found nothing.
 *
 * Pure: no IO, no clock beyond the `checkedAt` passed in. That is what lets the
 * rules be tested directly rather than through a mock of GitHub.
 */
export function deriveHealth(
  project: Pick<Project, "key" | "label" | "owner" | "repo">,
  probe: LoopProbe,
  checkedAt: string,
): LoopHealth {
  const faults: LoopFault[] = [];

  /* --- the token ------------------------------------------------- */
  // `false` only. `null` arrived as a `failures` entry below, because "the PAT
  // couldn't look" is not evidence of a missing secret.
  if (probe.secret === false) faults.push({ kind: "missing-token" });

  /* --- the switches ---------------------------------------------- */
  const claude = (probe.workflows ?? []).filter((w) => isClaudeWorkflowFile(w.file));
  const disabled = claude.filter((w) => !w.enabled);
  if (probe.workflows !== null) {
    if (claude.length === 0) {
      // Not a fault kind of its own — and deliberately not reported as
      // "workflows disabled", which would be a lie about a repo that simply
      // never had the loop installed. There is no loop here to assess, so the
      // honest verdict is `unknown` with the reason spelled out.
      faults.push({
        kind: "check-failed",
        what: "workflows",
        detail:
          "No claude-* workflows are installed in this repository, so there is no loop to check. Run the setup wizard for this project.",
      });
    } else if (disabled.length > 0) {
      faults.push({
        kind: "workflows-disabled",
        files: disabled.map((w) => w.file),
        names: disabled.map((w) => w.name),
      });
    }
  }

  /* --- the run history ------------------------------------------- */
  if (probe.runs !== null && probe.workflows !== null) {
    for (const workflow of claude) {
      const runs = probe.runs.get(workflow.file) ?? [];
      const streak = countFailureStreak(runs);
      if (streak < 2) continue; // one red run is noise, not a fault
      const latest = runs.find((r) => r.conclusion !== null);
      faults.push({
        kind: "runs-failing",
        workflowFile: workflow.file,
        workflowName: workflow.name,
        streak,
        lastRunUrl: latest?.htmlUrl ?? "",
        lastRunId: latest?.id ?? null,
      });
    }
  }

  /* --- the app --------------------------------------------------- */
  // When the run history was unreadable, `proven: false` means "we could not
  // establish it", NOT "it is disproved" — so no fault is raised. AppProof has
  // no third state by contract, so the honest reading of `proven: false` is
  // always conditioned on the verdict: under `unknown`, it means nothing.
  const allRuns = probe.runs ? [...probe.runs.values()].flat() : [];
  const appProof = deriveAppProof(allRuns);
  if (probe.runs !== null && claude.length > 0 && !appProof.proven) {
    faults.push({ kind: "app-unproven" });
  }

  /* --- the template ---------------------------------------------- */
  // `templateEmpty` is skipped on purpose: with no template workflows to
  // compare against, "in sync" and "drifted" are both meaningless, and an empty
  // template is a dashboard-side state rather than anything wrong with this
  // project. The drift endpoint already surfaces it where it belongs.
  if (probe.drift && !probe.drift.templateEmpty && !probe.drift.inSync) {
    const files = probe.drift.files
      .filter((f) => f.status === "repo-behind-or-diverged" || f.status === "missing-in-repo")
      .map((f) => f.file);
    if (files.length > 0) faults.push({ kind: "template-drift", files });
  }

  /* --- what we could not check ----------------------------------- */
  for (const failure of probe.failures) {
    faults.push({ kind: "check-failed", what: failure.what, detail: failure.detail });
  }

  /* --- the verdict ----------------------------------------------- */
  let verdict: LoopVerdict;
  if (faults.some((f) => isBlocking(f, claude.length, disabled.length))) {
    verdict = "blocked";
  } else if (faults.some((f) => f.kind === "check-failed")) {
    verdict = "unknown";
  } else if (faults.length > 0) {
    verdict = "degraded";
  } else {
    verdict = "healthy";
  }

  return {
    projectKey: project.key,
    label: project.label,
    owner: project.owner,
    repo: project.repo,
    verdict,
    faults,
    appProof,
    checkedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Reading GitHub                                                      */
/* ------------------------------------------------------------------ */

/** How many recent runs to pull per repo for the streak walk. */
const RUN_WINDOW = 100;

/** Turn one raw run into the trimmed shape the rules work on. */
function toRunSummary(run: {
  id: number;
  path?: string;
  name?: string | null;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  created_at: string;
}): RunSummary {
  return {
    id: run.id,
    workflowFile: (run.path ?? "").replace(/^\.github\/workflows\//, ""),
    workflowName: run.name ?? "",
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
  };
}

function groupByWorkflow(runs: RunSummary[]): Map<string, RunSummary[]> {
  const out = new Map<string, RunSummary[]>();
  for (const run of runs) {
    if (!run.workflowFile) continue;
    const list = out.get(run.workflowFile);
    if (list) list.push(run);
    else out.set(run.workflowFile, [run]);
  }
  // Most recent first, so the streak walk reads forwards.
  for (const list of out.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

/**
 * Recent runs for a repo, grouped by workflow file.
 *
 * ONE repo-wide call rather than one call per workflow: a project has ~8 loop
 * workflows and the PAT is rate-limited, so per-workflow listing would multiply
 * the whole sweep by eight for no better answer.
 *
 * The cost of that choice is a window: a workflow whose last run fell outside
 * the most recent {@link RUN_WINDOW} runs simply has no history here. That is
 * fine for streaks (no runs → no streak → no fault) but NOT fine for app proof,
 * where "nothing green in the window" would become "the app has never worked".
 * So when the window contains no successful claude run, and only then, a second
 * targeted call asks GitHub directly for successful runs before we are willing
 * to make that negative claim.
 */
async function readRuns(repo: RepoConfig): Promise<Map<string, RunSummary[]>> {
  const recent = (await getWorkflowRuns({ repo, per_page: RUN_WINDOW })).map(toRunSummary);
  const grouped = groupByWorkflow(recent);

  const hasGreenClaudeRun = recent.some(
    (r) => isClaudeWorkflowFile(r.workflowFile) && r.conclusion === "success",
  );
  if (hasGreenClaudeRun) return grouped;

  // About to claim "no claude workflow has ever succeeded" — check properly first.
  const successes = (
    await getWorkflowRuns({ repo, per_page: 30, status: "success" })
  ).map(toRunSummary);
  for (const run of successes) {
    if (!run.workflowFile) continue;
    const list = grouped.get(run.workflowFile);
    if (!list) {
      grouped.set(run.workflowFile, [run]);
    } else if (!list.some((r) => r.id === run.id)) {
      // Append, not prepend: these are older than the window by definition, so
      // they must not be allowed to terminate a streak walk they predate.
      list.push(run);
    }
  }
  return grouped;
}

/** Is `CLAUDE_CODE_OAUTH_TOKEN` set on this repo? Same call as the checklist route. */
async function readSecret(repo: RepoConfig): Promise<boolean> {
  const res = await getOctokit().rest.actions.listRepoSecrets({
    owner: repo.owner,
    repo: repo.repo,
    per_page: 100,
  });
  return res.data.secrets.some((s) => s.name === "CLAUDE_CODE_OAUTH_TOKEN");
}

function describeError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);
  return status ? `${message} (HTTP ${status})` : message;
}

/**
 * Read every signal for one project. Each check is independent: one failing
 * turns into a `failures` entry and the rest still produce real answers, so a
 * repo whose secrets are unreadable still reports its disabled workflows.
 */
export async function probeProject(project: Project): Promise<LoopProbe> {
  const repo: RepoConfig = { owner: project.owner, repo: project.repo };
  const failures: { what: string; detail: string }[] = [];

  const [secret, workflows, runs, drift] = await Promise.all([
    readSecret(repo).catch((err) => {
      // Exactly the checklist route's handling: the token not being allowed to
      // list secrets is not evidence about the secret.
      failures.push({
        what: "secret",
        detail: `Couldn't read this repo's Actions secrets, so we can't tell whether CLAUDE_CODE_OAUTH_TOKEN is set. ${describeError(err)}`,
      });
      return null;
    }),
    listLoopWorkflows(repo).catch((err) => {
      failures.push({
        what: "workflows",
        detail: `Couldn't list this repo's workflows, so we can't tell which agents are switched on. ${describeError(err)}`,
      });
      return null;
    }),
    readRuns(repo).catch((err) => {
      failures.push({
        what: "runs",
        detail: `Couldn't read this repo's workflow runs, so we can't tell whether the agents are failing or whether the GitHub App has ever worked. ${describeError(err)}`,
      });
      return null;
    }),
    computeTemplateDrift(project.key, repo).catch((err) => {
      failures.push({
        what: "template-drift",
        detail: `Couldn't compare this repo's workflows against the template. ${describeError(err)}`,
      });
      return null;
    }),
  ]);

  return { secret, workflows, runs, drift, failures };
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

/**
 * A preflight is expensive — four GitHub calls per project, and the drift
 * comparison is itself a directory listing plus one read per workflow file, on
 * both sides. A board that re-swept on every page load would burn the PAT's
 * hourly budget on refreshes nobody asked for, so results are memoised in
 * process for a minute, matching the 60s TTL pattern in lib/projects.ts and
 * lib/local-folders.ts.
 *
 * Two wrinkles the plain pattern doesn't have:
 *
 * - `unknown` results get a much shorter TTL. An `unknown` usually means a
 *   transient GitHub blip, and pinning the whole board to "we don't know" for a
 *   full minute after one 502 is the wrong trade — a healthy result is worth
 *   holding on to, a failed lookup is worth retrying.
 * - The POST repairs invalidate their project's entry, so the board reflects a
 *   click immediately instead of showing the fault the click just fixed.
 */
const HEALTH_TTL_MS = 60_000;
const UNKNOWN_TTL_MS = 15_000;

const healthCache = new Map<string, { at: number; health: LoopHealth }>();

function cachedHealth(key: string): LoopHealth | null {
  const hit = healthCache.get(key);
  if (!hit) return null;
  const ttl = hit.health.verdict === "unknown" ? UNKNOWN_TTL_MS : HEALTH_TTL_MS;
  if (Date.now() - hit.at >= ttl) return null;
  return hit.health;
}

/** Drop one project's memoised result — called after a repair changes the truth. */
export function invalidateHealth(projectKey: string): void {
  healthCache.delete(projectKey);
}

/* ------------------------------------------------------------------ */
/* The sweep                                                           */
/* ------------------------------------------------------------------ */

/** One project, end to end. Never throws — a broken project reports `unknown`. */
export async function checkProject(project: Project, force = false): Promise<LoopHealth> {
  if (!force) {
    const hit = cachedHealth(project.key);
    if (hit) return hit;
  }
  const checkedAt = new Date().toISOString();
  let health: LoopHealth;
  try {
    health = deriveHealth(project, await probeProject(project), checkedAt);
  } catch (err) {
    // probeProject already isolates every individual check, so reaching here
    // means something structural went wrong (no GITHUB_TOKEN at all, say).
    // Still a verdict, still honest, still not "healthy".
    console.error(`loop-health: probe failed for ${project.key}`, err);
    health = {
      projectKey: project.key,
      label: project.label,
      owner: project.owner,
      repo: project.repo,
      verdict: "unknown",
      faults: [
        {
          kind: "check-failed",
          what: "preflight",
          detail: `The preflight couldn't run for this project. ${describeError(err)}`,
        },
      ],
      appProof: { proven: false, runUrl: null, at: null },
      checkedAt,
    };
  }
  healthCache.set(project.key, { at: Date.now(), health });
  return health;
}

/**
 * How many projects to check at once.
 *
 * Each project costs roughly a dozen GitHub calls once drift's fan-out is
 * counted, so this is a rate-limit throttle rather than a CPU one. Three keeps
 * a sweep of the whole registry comfortably inside the PAT's budget while still
 * being several times faster than doing them one after another.
 */
const PROJECT_CONCURRENCY = 3;

/** Run `worker` over `items`, at most `limit` at a time, preserving order. */
async function mapBounded<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await worker(items[index]!);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Preflight every registered project (or just one, when `projectKey` is given).
 *
 * One slow or failing project must not sink the sweep: `checkProject` swallows
 * its own errors into an `unknown` verdict, so the board always renders every
 * project — the broken one included, with the reason attached. The only thing
 * that can throw out of here is the registry read itself, which is genuinely
 * fatal (there is nothing to show) and is already a `ProjectError` the routes
 * know how to surface.
 */
export async function sweepLoopHealth(opts: {
  projectKey?: string | null;
  force?: boolean;
} = {}): Promise<LoopHealthPayload> {
  const all = await listProjects();
  const wanted = (opts.projectKey ?? "").trim();
  const projects = wanted ? all.filter((p) => p.key === wanted) : all;

  const results = await mapBounded(projects, PROJECT_CONCURRENCY, (project) =>
    checkProject(project, opts.force === true),
  );
  return { projects: results, checkedAt: new Date().toISOString() };
}
