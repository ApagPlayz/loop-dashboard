/**
 * Background jobs for AI drafting.
 *
 * A draft request no longer holds its HTTP request open while the CLI runs —
 * the POST route creates a job, kicks the work off asynchronously, and returns
 * a job id immediately. The client polls GET /api/map/ai-job/[id] (and can
 * leave the page: GET /api/map/ai-job/latest restores the newest unconsumed
 * job when a panel mounts again).
 *
 * Storage: an in-process Map (the local server is one long-lived Node
 * process) PLUS a file per job under os.tmpdir()/loop-dashboard-ai-jobs/ as a
 * safety net across request contexts. Jobs expire after one hour.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AiError } from "./map-ai";

export type AiJobKind = "draft" | "loop-edit" | "process-chat";
export type AiJobStatus = "running" | "done" | "error";

export type AiJob = {
  id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms of the last status change. */
  updatedAt: number;
  /** Small metadata only (request text, agent id, mode) — never the big YAML. */
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
  /** HTTP-ish status for the error, mirrored from AiError. */
  errorStatus?: number;
  /** True once the owner applied/used/discarded the result. */
  consumed: boolean;
};

const TTL_MS = 60 * 60 * 1000; // 1 hour

const jobs = new Map<string, AiJob>();

/* ------------------------------------------------------------------ */
/* File persistence (safety net)                                       */
/* ------------------------------------------------------------------ */

function jobsDir(): string {
  const dir = path.join(tmpdir(), "loop-dashboard-ai-jobs");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return dir;
}

function jobFile(id: string): string {
  // ids are our own UUIDs — still keep the filename strictly safe.
  return path.join(jobsDir(), `${id.replace(/[^a-zA-Z0-9-]/g, "")}.json`);
}

function persist(job: AiJob): void {
  try {
    writeFileSync(jobFile(job.id), JSON.stringify(job), "utf-8");
  } catch (err) {
    console.warn("ai-jobs: persist failed", err);
  }
}

function readFromDisk(id: string): AiJob | null {
  try {
    const raw = readFileSync(jobFile(id), "utf-8");
    return JSON.parse(raw) as AiJob;
  } catch {
    return null;
  }
}

/** Drop expired jobs from memory and disk. Cheap; called on each access. */
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
        jobs.set(id, job); // re-hydrate (e.g. after a dev-server reload)
      }
    }
  } catch {
    /* best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Create a job and start its work WITHOUT awaiting it. The returned job is
 * already persisted in "running" state; `work` resolves or rejects later and
 * updates the record.
 */
export function startJob(
  kind: AiJobKind,
  input: Record<string, unknown>,
  work: () => Promise<unknown>,
): AiJob {
  sweep();
  const job: AiJob = {
    id: randomUUID(),
    kind,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input,
    consumed: false,
  };
  jobs.set(job.id, job);
  persist(job);

  work()
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
        console.error(`ai-jobs: ${kind} job failed`, err);
        job.error = "Something went wrong while drafting. Try again.";
        job.errorStatus = 502;
      }
      persist(job);
    });

  return job;
}

export function getJob(id: string): AiJob | null {
  sweep();
  const inMem = jobs.get(id);
  if (inMem) return inMem;
  const fromDisk = readFromDisk(id);
  if (fromDisk) {
    // A "running" job found only on disk means the process that ran it died
    // (e.g. server restart) — its promise is gone, so it can never finish.
    if (fromDisk.status === "running" && Date.now() - fromDisk.updatedAt > 15 * 60 * 1000) {
      fromDisk.status = "error";
      fromDisk.error = "The draft was interrupted (the dashboard restarted). Try again.";
      fromDisk.errorStatus = 502;
    }
    jobs.set(fromDisk.id, fromDisk);
    return fromDisk;
  }
  return null;
}

/** Newest unconsumed job of a kind, optionally filtered (e.g. by agent id). */
export function latestJob(
  kind: AiJobKind,
  filter?: (input: Record<string, unknown>) => boolean,
): AiJob | null {
  sweep();
  let best: AiJob | null = null;
  for (const job of jobs.values()) {
    if (job.kind !== kind || job.consumed) continue;
    if (filter && !filter(job.input)) continue;
    if (!best || job.createdAt > best.createdAt) best = job;
  }
  return best;
}

/** Public (wire) view of a job — small metadata only, never big blobs. */
export function toPublicJob(job: AiJob) {
  const { request, agentId, mode, project } = job.input as {
    request?: string;
    agentId?: string;
    mode?: string;
    project?: string;
  };
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    createdAt: job.createdAt,
    input: {
      request: typeof request === "string" ? request.slice(0, 2000) : undefined,
      agentId,
      mode,
      project,
    },
    result: job.result,
    error: job.error,
    errorStatus: job.errorStatus,
    consumed: job.consumed,
  };
}

/** Mark a job consumed (owner applied/used/discarded it). */
export function consumeJob(id: string): boolean {
  const job = getJob(id);
  if (!job) return false;
  job.consumed = true;
  job.updatedAt = Date.now();
  persist(job);
  return true;
}
