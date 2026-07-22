/**
 * Per-project loop config: `.github/loop-config.json`, committed INSIDE each
 * target repo (not the dashboard's own repo) — mirrors lib/map-power.ts's
 * "read/write a small JSON file on a target repo via the Contents API"
 * pattern. The target repos' own workflows read this file at runtime with a
 * `jq ... // default` fallback, so a missing file is always safe: it just
 * means "use the defaults below."
 */

import { getFileContent, commitFile, type RepoConfig } from "./github";

export const LOOP_CONFIG_PATH = ".github/loop-config.json";

export type LoopConfig = {
  version: number;
  autonomousBuildEnabled: boolean;
  prCap: number | "unlimited";
  ideaQueueCap: number | "unlimited";
};

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  version: 1,
  autonomousBuildEnabled: false,
  prCap: 3,
  ideaQueueCap: 25,
};

/** Error carrying the HTTP status a route should surface for it. */
export class LoopConfigError extends Error {
  constructor(
    message: string,
    public httpStatus: number = 400,
  ) {
    super(message);
    this.name = "LoopConfigError";
  }
}

function parseLoopConfig(raw: string | null): LoopConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LoopConfig>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return { ...DEFAULT_LOOP_CONFIG, ...parsed };
  } catch {
    return null;
  }
}

/**
 * Read a project's loop config. Never throws for a missing or unparsable
 * file — falls back to {@link DEFAULT_LOOP_CONFIG}, same contract as the
 * target repos' own `jq ... // default` reads.
 */
export async function getLoopConfig(repo: RepoConfig): Promise<LoopConfig> {
  try {
    const raw = await getFileContent(LOOP_CONFIG_PATH, undefined, repo);
    return parseLoopConfig(raw) ?? DEFAULT_LOOP_CONFIG;
  } catch (err) {
    console.error("loop-config: read failed", err);
    return DEFAULT_LOOP_CONFIG;
  }
}

function validatePatch(next: LoopConfig): void {
  if (
    next.prCap !== "unlimited" &&
    (!Number.isInteger(next.prCap) || next.prCap <= 0)
  ) {
    throw new LoopConfigError('prCap must be a positive integer or "unlimited".');
  }
  if (
    next.ideaQueueCap !== "unlimited" &&
    (!Number.isInteger(next.ideaQueueCap) || next.ideaQueueCap <= 0)
  ) {
    throw new LoopConfigError('ideaQueueCap must be a positive integer or "unlimited".');
  }
  if (typeof next.autonomousBuildEnabled !== "boolean") {
    throw new LoopConfigError("autonomousBuildEnabled must be true or false.");
  }
}

/**
 * Merge `patch` over the current (or default) config, validate, and commit
 * `.github/loop-config.json` to the target repo. Returns the saved config.
 */
export async function setLoopConfig(
  repo: RepoConfig,
  patch: Partial<LoopConfig>,
): Promise<LoopConfig> {
  const current = await getLoopConfig(repo);
  const next: LoopConfig = { ...current, ...patch };
  validatePatch(next);
  await commitFile(
    LOOP_CONFIG_PATH,
    JSON.stringify(next, null, 2) + "\n",
    "dashboard: update loop config",
    { repo },
  );
  return next;
}
