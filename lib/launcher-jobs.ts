/**
 * Background jobs for launcher analysis (Claude working out how to launch a
 * project). The analysis shells out to the local Claude CLI and can take a
 * minute or more, so the POST route creates a job, starts the work without
 * awaiting it, and returns a job id; the client polls GET /api/launch/analyze/[id].
 *
 * Mirrors lib/tool-fit-jobs.ts: in-process Map plus a per-job JSON file under
 * the OS temp dir as a cross-request safety net, one-hour TTL, and detection
 * of jobs orphaned by a server restart.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AiError } from "./map-ai";
import { analyzeAndCreateLauncher, type LauncherConfig } from "./launchers";

export type LaunchJobStatus = "running" | "done" | "error";

export type LaunchJob = {
  id: string;
  projectKey: string;
  status: LaunchJobStatus;
  createdAt: number;
  updatedAt: number;
  result?: LauncherConfig;
  error?: string;
  errorStatus?: number;
};

const TTL_MS = 60 * 60 * 1000; // 1 hour
const jobs = new Map<string, LaunchJob>();

/* ------------------------------------------------------------------ */
/* File persistence (safety net)                                       */
/* ------------------------------------------------------------------ */

function jobsDir(): string {
  const dir = path.join(tmpdir(), "loop-dashboard-launcher-jobs");
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

function persist(job: LaunchJob): void {
  try {
    writeFileSync(jobFile(job.id), JSON.stringify(job), "utf-8");
  } catch (err) {
    console.warn("launcher-jobs: persist failed", err);
  }
}

function readFromDisk(id: string): LaunchJob | null {
  try {
    return JSON.parse(readFileSync(jobFile(id), "utf-8")) as LaunchJob;
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

/** Create an analysis job and start it WITHOUT awaiting. Returns the job. */
export function startLaunchAnalysisJob(projectKey: string): LaunchJob {
  sweep();
  const job: LaunchJob = {
    id: randomUUID(),
    projectKey,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  persist(job);

  analyzeAndCreateLauncher(projectKey)
    .then((result) => {
      job.status = "done";
      job.result = result;
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
        console.error("launcher-jobs: analysis failed", err);
        job.error = "Something went wrong while analyzing the project. Try again.";
        job.errorStatus = 502;
      }
      persist(job);
    });

  return job;
}

export function getLaunchJob(id: string): LaunchJob | null {
  sweep();
  const inMem = jobs.get(id);
  if (inMem) return inMem;
  const fromDisk = readFromDisk(id);
  if (fromDisk) {
    // A "running" job found only on disk means the process that ran it died
    // (e.g. a server restart) — its promise is gone, so mark it interrupted.
    if (fromDisk.status === "running" && Date.now() - fromDisk.updatedAt > 15 * 60 * 1000) {
      fromDisk.status = "error";
      fromDisk.error = "The analysis was interrupted (the dashboard restarted). Try again.";
      fromDisk.errorStatus = 502;
    }
    jobs.set(fromDisk.id, fromDisk);
    return fromDisk;
  }
  return null;
}

/** The newest analysis job for a project, if any (lets the UI restore one). */
export function latestLaunchJobForProject(projectKey: string): LaunchJob | null {
  sweep();
  let best: LaunchJob | null = null;
  for (const job of jobs.values()) {
    if (job.projectKey !== projectKey) continue;
    if (!best || job.createdAt > best.createdAt) best = job;
  }
  return best;
}
