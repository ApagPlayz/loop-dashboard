/**
 * Background jobs for the "Find tools for a project" scan.
 *
 * A scan can take minutes (it AI-scores up to ~100 tools in batches), so the
 * POST route creates a job, kicks the work off asynchronously, and returns a
 * job id immediately. The client polls GET /api/tools/fit/[id] and can leave
 * the page and come back — the newest job per repo is restorable.
 *
 * Mirrors the pattern in lib/map-ai-jobs.ts (in-process Map + a temp-dir file
 * per job as a cross-request safety net, one-hour TTL) but adds live progress
 * and keys jobs by repo. The finished ScanResult is ALSO cached per repo by
 * lib/tool-fit.ts, so re-opening a scanned repo is instant even after the job
 * expires.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AiError } from "./map-ai";
import { runScan, repoKey, type ScanProgress, type ScanResult } from "./tool-fit";

export type FitJobStatus = "running" | "done" | "error";

export type FitJob = {
  id: string;
  owner: string;
  repo: string;
  status: FitJobStatus;
  createdAt: number;
  updatedAt: number;
  progress: ScanProgress;
  result?: ScanResult;
  error?: string;
  errorStatus?: number;
  /** True once the owner closed/replaced the scan — stops it being restored. */
  consumed?: boolean;
};

const TTL_MS = 60 * 60 * 1000; // 1 hour
const jobs = new Map<string, FitJob>();

/* ------------------------------------------------------------------ */
/* File persistence (safety net)                                       */
/* ------------------------------------------------------------------ */

function jobsDir(): string {
  const dir = path.join(tmpdir(), "loop-dashboard-tool-fit-jobs");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return dir;
}

function jobFile(id: string): string {
  return path.join(jobsDir(), `${id.replace(/[^a-zA-Z0-9-]/g, "")}.json`);
}

function persist(job: FitJob): void {
  try {
    writeFileSync(jobFile(job.id), JSON.stringify(job), "utf-8");
  } catch (err) {
    console.warn("tool-fit-jobs: persist failed", err);
  }
}

function readFromDisk(id: string): FitJob | null {
  try {
    return JSON.parse(readFileSync(jobFile(id), "utf-8")) as FitJob;
  } catch {
    return null;
  }
}

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      jobs.delete(id);
      try {
        rmSync(jobFile(id), { force: true });
      } catch {
        /* best-effort */
      }
    }
  }
  try {
    for (const name of readdirSync(jobsDir())) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (jobs.has(id)) continue;
      const job = readFromDisk(id);
      if (!job || job.createdAt < cutoff) {
        rmSync(path.join(jobsDir(), name), { force: true });
      } else {
        jobs.set(id, job);
      }
    }
  } catch {
    /* best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** Create a scan job and start it WITHOUT awaiting. Returns the running job. */
export function startFitJob(owner: string, repo: string): FitJob {
  sweep();
  const job: FitJob = {
    id: randomUUID(),
    owner,
    repo,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { phase: "profiling", done: 0, total: 0 },
  };
  jobs.set(job.id, job);
  persist(job);

  runScan(owner, repo, (p) => {
    job.progress = p;
    job.updatedAt = Date.now();
    persist(job);
  })
    .then((result) => {
      job.status = "done";
      job.result = result;
      job.progress = { phase: "done", done: result.aiScoredCount, total: result.aiScoredCount };
      job.updatedAt = Date.now();
      persist(job);
    })
    .catch((err: unknown) => {
      job.status = "error";
      job.updatedAt = Date.now();
      if (err instanceof AiError) {
        job.error = err.message;
        job.errorStatus = err.httpStatus;
      } else {
        console.error("tool-fit-jobs: scan failed", err);
        const status = (err as { status?: number })?.status;
        job.error =
          status === 404
            ? "Couldn't find that repository, or the token can't see it. Check the owner/name."
            : "Something went wrong during the scan. Try again.";
        job.errorStatus = status === 404 ? 404 : 502;
      }
      persist(job);
    });

  return job;
}

export function getFitJob(id: string): FitJob | null {
  sweep();
  const inMem = jobs.get(id);
  if (inMem) return inMem;
  const fromDisk = readFromDisk(id);
  if (fromDisk) {
    // A "running" job found only on disk means the process that ran it died
    // (e.g. a server restart) — its promise is gone, so mark it interrupted.
    if (fromDisk.status === "running" && Date.now() - fromDisk.updatedAt > 15 * 60 * 1000) {
      fromDisk.status = "error";
      fromDisk.error = "The scan was interrupted (the dashboard restarted). Try again.";
      fromDisk.errorStatus = 502;
    }
    jobs.set(fromDisk.id, fromDisk);
    return fromDisk;
  }
  return null;
}

/**
 * The newest unconsumed job across ALL repos (used to restore the panel when
 * the owner navigated away mid-scan and comes back — the panel doesn't know
 * which repo was being scanned, so this tells it).
 */
export function latestFitJob(): FitJob | null {
  sweep();
  let best: FitJob | null = null;
  for (const job of jobs.values()) {
    if (job.consumed) continue;
    if (!best || job.createdAt > best.createdAt) best = job;
  }
  return best;
}

/** Mark a job consumed (the owner closed or replaced it). */
export function consumeFitJob(id: string): boolean {
  const job = getFitJob(id);
  if (!job) return false;
  job.consumed = true;
  job.updatedAt = Date.now();
  persist(job);
  return true;
}

/** The newest job for a given repo, if any (used to restore on mount). */
export function latestFitJobForRepo(owner: string, repo: string): FitJob | null {
  sweep();
  const key = repoKey(owner, repo);
  let best: FitJob | null = null;
  for (const job of jobs.values()) {
    if (repoKey(job.owner, job.repo) !== key) continue;
    if (!best || job.createdAt > best.createdAt) best = job;
  }
  return best;
}
