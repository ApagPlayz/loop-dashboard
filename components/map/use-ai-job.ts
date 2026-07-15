"use client";

/**
 * Client-side companion to the AI drafting jobs: submit a request, poll the
 * job every 2.5s, and — on mount — restore the newest unconsumed job of this
 * kind so the owner can leave the page mid-draft and come back.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type PublicAiJob = {
  id: string;
  kind: "draft" | "loop-edit";
  status: "running" | "done" | "error";
  createdAt: number;
  input: { request?: string; agentId?: string; mode?: string };
  result?: unknown;
  error?: string;
  consumed: boolean;
};

const POLL_MS = 2500;

export function useAiJob(opts: {
  kind: "draft" | "loop-edit";
  agentId?: string;
  /** Project registry key — scopes job restore to the selected project. */
  project?: string;
}) {
  const { kind, agentId, project } = opts;
  const [job, setJob] = useState<PublicAiJob | null>(null);
  /** Errors from submitting (validation, AI off) — not job failures. */
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimers = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    pollTimer.current = null;
    tickTimer.current = null;
  }, []);

  const beginPolling = useCallback(
    (jobId: string, createdAt: number) => {
      stopTimers();
      setElapsedSec(Math.max(0, Math.floor((Date.now() - createdAt) / 1000)));
      tickTimer.current = setInterval(() => {
        setElapsedSec(Math.max(0, Math.floor((Date.now() - createdAt) / 1000)));
      }, 1000);
      pollTimer.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/map/ai-job/${jobId}`);
          if (res.status === 404) {
            stopTimers();
            setJob(null);
            setSubmitError("That draft expired. Start a new one.");
            return;
          }
          const j = await res.json().catch(() => ({}));
          if (j.job) {
            setJob(j.job);
            if (j.job.status !== "running") stopTimers();
          }
        } catch {
          // Transient network blip — keep polling.
        }
      }, POLL_MS);
    },
    [stopTimers],
  );

  // On mount: restore the newest unconsumed job of this kind.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Scope change (e.g. project switch): drop whatever was showing.
        setJob(null);
        stopTimers();
        const params = new URLSearchParams({ kind });
        if (agentId) params.set("agentId", agentId);
        if (project) params.set("project", project);
        const res = await fetch(`/api/map/ai-job/latest?${params}`);
        const j = await res.json().catch(() => ({}));
        if (cancelled || !j.job) return;
        setJob(j.job);
        if (j.job.status === "running") beginPolling(j.job.id, j.job.createdAt);
      } catch {
        // No restore — not fatal.
      }
    })();
    return () => {
      cancelled = true;
      stopTimers();
    };
  }, [kind, agentId, project, beginPolling, stopTimers]);

  /** POST to a drafting route that returns { jobId }; start polling it. */
  const start = useCallback(
    async (url: string, body: unknown) => {
      setSubmitting(true);
      setSubmitError(null);
      setJob(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? "Couldn't start drafting.");
        const now = Date.now();
        setJob({
          id: j.jobId,
          kind,
          status: "running",
          createdAt: now,
          input: {},
          consumed: false,
        });
        beginPolling(j.jobId, now);
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "Couldn't start drafting.");
      } finally {
        setSubmitting(false);
      }
    },
    [kind, beginPolling],
  );

  /** Mark the current job consumed (applied or discarded) and clear it. */
  const consume = useCallback(async () => {
    const id = job?.id;
    stopTimers();
    setJob(null);
    if (id) {
      fetch(`/api/map/ai-job/${id}`, { method: "POST" }).catch(() => {});
    }
  }, [job?.id, stopTimers]);

  return { job, submitting, submitError, elapsedSec, start, consume };
}

/** "1m 23s" for the drafting timer. */
export function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
