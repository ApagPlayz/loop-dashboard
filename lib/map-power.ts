/**
 * Loop power controls: pause/resume the whole loop, or single workflows,
 * using GitHub's workflow enable/disable API. Nothing is ever deleted —
 * a disabled workflow just stops being triggered until re-enabled.
 *
 * There is no state store for the on/off switches themselves — GitHub's
 * native workflow state (`active` / `disabled_manually`) IS the state.
 *
 * There IS a tiny state file for one thing master pause/resume needs that
 * GitHub's workflow state can't tell us: which workflows a PAUSE actually
 * turned off, as opposed to ones the owner had already switched off on
 * purpose (e.g. a flaky Scout disabled by hand). Without that record,
 * master Resume can't tell the two apart and blanket-enabling everything
 * would silently undo a deliberate decision. `.github/loop-pause-state.json`
 * is committed to the TARGET repo — same "small JSON file via the Contents
 * API" pattern `.github/loop-config.json` uses (lib/loop-config.ts) — rather
 * than a repo variable, because Contents write is the permission this app's
 * token is already proven to have on target repos (loop-config saves ship
 * today), while repo *variables* live under a separate, unverified
 * permission. It also sits outside `.github/workflows/`, so it doesn't need
 * the extra "Workflows" permission that editing workflow YAML requires.
 */

import { getOctokit, getFileContent, getFileWithSha, commitFile, type RepoConfig } from "./github";

export const MENTION_FILE = "claude-mention.yml";

export type WorkflowPower = {
  /** Filename, e.g. "claude-scout.yml". */
  file: string;
  /** The workflow's display name from its YAML. */
  name: string;
  /** GitHub state: "active", "disabled_manually", ... */
  state: string;
  enabled: boolean;
  /** True for the @mention remote control (special-cased in master pause). */
  isMention: boolean;
};

/** Is this file part of the loop (subject to the power menu)? */
function isLoopWorkflow(path: string): boolean {
  const file = path.replace(/^\.github\/workflows\//, "");
  return /^claude-.*\.ya?ml$/.test(file) || file === "loop-metrics.yml";
}

/** Current on/off state of every loop workflow in a repo. */
export async function listLoopWorkflows(repo: RepoConfig): Promise<WorkflowPower[]> {
  const res = await getOctokit().rest.actions.listRepoWorkflows({
    owner: repo.owner,
    repo: repo.repo,
    per_page: 100,
  });
  return res.data.workflows
    .filter((w) => isLoopWorkflow(w.path))
    .map((w) => {
      const file = w.path.replace(/^\.github\/workflows\//, "");
      return {
        file,
        name: w.name,
        state: w.state,
        enabled: w.state === "active",
        isMention: file === MENTION_FILE,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** Switch one workflow on or off. `file` is the workflow filename. */
export async function setWorkflowEnabled(
  repo: RepoConfig,
  file: string,
  enabled: boolean,
): Promise<void> {
  const octokit = getOctokit();
  const params = { owner: repo.owner, repo: repo.repo, workflow_id: file };
  if (enabled) await octokit.rest.actions.enableWorkflow(params);
  else await octokit.rest.actions.disableWorkflow(params);
}

/* ------------------------------------------------------------------ */
/* Pre-pause state record                                              */
/* ------------------------------------------------------------------ */

const PAUSE_STATE_PATH = ".github/loop-pause-state.json";

export type PauseState = {
  /** Workflow filenames master pause actually disabled — the exact set Resume should restore. */
  disabled: string[];
  /** ISO timestamp of the pause that produced this record. */
  pausedAt: string;
};

function parsePauseState(raw: string | null): PauseState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { disabled?: unknown; pausedAt?: unknown };
    if (!Array.isArray(parsed.disabled) || !parsed.disabled.every((f) => typeof f === "string")) {
      return null;
    }
    if (typeof parsed.pausedAt !== "string") return null;
    return { disabled: parsed.disabled, pausedAt: parsed.pausedAt };
  } catch {
    return null;
  }
}

/**
 * Read the recorded pre-pause state. Returns `null` for every "we don't
 * really know" case — the file doesn't exist (never paused from here, or
 * paused before this feature shipped), the read failed, or the content is
 * unparseable (e.g. hand-edited). Callers treat `null` as "no usable
 * record" and degrade to the confirm-before-blanket-enable path; this never
 * throws so a flaky read can't block the owner from resuming at all.
 */
export async function readPauseState(repo: RepoConfig): Promise<PauseState | null> {
  try {
    return parsePauseState(await getFileContent(PAUSE_STATE_PATH, undefined, repo));
  } catch (err) {
    console.error("map-power: pause-state read failed", err);
    return null;
  }
}

/**
 * Record which workflows a pause actually disabled. Best-effort: the
 * workflows are already off by the time this runs (that's the operation
 * that matters), so a failure here is logged and swallowed rather than
 * failing the pause — it just means the next Resume falls back to the
 * confirm-first path instead of restoring precisely.
 */
async function recordPauseState(repo: RepoConfig, disabled: string[]): Promise<void> {
  try {
    const existing = await getFileWithSha(PAUSE_STATE_PATH, undefined, repo);
    const state: PauseState = { disabled, pausedAt: new Date().toISOString() };
    await commitFile(
      PAUSE_STATE_PATH,
      JSON.stringify(state, null, 2) + "\n",
      "loop: record pre-pause workflow state",
      { repo, expectedSha: existing?.sha ?? null },
    );
  } catch (err) {
    console.error("map-power: failed to record pause state", err);
  }
}

/**
 * Clear the record after a precise resume has consumed it. Also
 * best-effort — leaving a stale record behind is harmless (the next real
 * pause overwrites it, and a resume always intersects the record against
 * what's actually still disabled), this just keeps it tidy.
 */
async function clearPauseState(repo: RepoConfig): Promise<void> {
  try {
    const existing = await getFileWithSha(PAUSE_STATE_PATH, undefined, repo);
    if (!existing) return;
    const state: PauseState = { disabled: [], pausedAt: new Date().toISOString() };
    await commitFile(
      PAUSE_STATE_PATH,
      JSON.stringify(state, null, 2) + "\n",
      "loop: clear pause state after resume",
      { repo, expectedSha: existing.sha },
    );
  } catch (err) {
    console.error("map-power: failed to clear pause state", err);
  }
}

/* ------------------------------------------------------------------ */
/* Master pause / resume                                               */
/* ------------------------------------------------------------------ */

/**
 * Master pause: switch off every loop workflow EXCEPT @mention (the owner's
 * phone remote control stays reachable unless turned off individually), and
 * record exactly which files this call disabled so Resume can restore
 * precisely instead of guessing.
 */
export async function pauseLoop(repo: RepoConfig): Promise<string[]> {
  const workflows = await listLoopWorkflows(repo);
  const targets = workflows.filter((w) => w.enabled && !w.isMention);
  for (const w of targets) {
    await setWorkflowEnabled(repo, w.file, false);
  }
  const files = targets.map((w) => w.file);
  // Only overwrite the record when this call actually disabled something —
  // a no-op pause (already paused) must not clobber a good prior record
  // with an empty one.
  if (files.length > 0) await recordPauseState(repo, files);
  return files;
}

export type ResumeResult =
  // Restored exactly what the recorded pause disabled (record may legitimately be empty).
  | { mode: "restored"; changed: string[] }
  // No usable record; the caller explicitly confirmed enabling everything currently off.
  | { mode: "blanket"; changed: string[] }
  // No usable record and no confirmation yet — nothing was changed.
  | { mode: "needs-confirmation"; wouldEnable: string[] };

/**
 * Master resume. Prefers restoring exactly the workflows the last pause
 * disabled (per the recorded state), leaving anything switched off on
 * purpose alone. When no usable record exists — paused before this
 * feature existed, or paused directly via `gh`/GitHub's UI — it refuses to
 * guess: it reports what a blanket "enable everything currently off" would
 * touch and does nothing further unless `confirmBlanket` is set, which
 * reproduces the old (pre-this-feature) behaviour explicitly and on request.
 */
export async function resumeLoop(
  repo: RepoConfig,
  opts: { confirmBlanket?: boolean } = {},
): Promise<ResumeResult> {
  const workflows = await listLoopWorkflows(repo);
  const disabledNow = new Set(workflows.filter((w) => !w.enabled).map((w) => w.file));

  const record = await readPauseState(repo);
  if (record) {
    // Intersect with what's still actually disabled: a workflow re-enabled
    // individually since the pause, or removed from the repo, is skipped
    // rather than force-set.
    const targets = record.disabled.filter((f) => disabledNow.has(f));
    for (const file of targets) {
      await setWorkflowEnabled(repo, file, true);
    }
    await clearPauseState(repo);
    return { mode: "restored", changed: targets };
  }

  if (!opts.confirmBlanket) {
    return { mode: "needs-confirmation", wouldEnable: [...disabledNow].sort() };
  }
  const targets = [...disabledNow];
  for (const file of targets) {
    await setWorkflowEnabled(repo, file, true);
  }
  return { mode: "blanket", changed: targets };
}
