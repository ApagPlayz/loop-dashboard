/**
 * The job store that keeps a PAUSED LangGraph alive between two HTTP requests.
 *
 * Everything here injects fake `TriageDeps`, so no test touches GitHub or an
 * LLM. The point of the file is the thing that is easy to get wrong and
 * invisible when you do: a resume has to re-enter the SAME parked graph. If the
 * store ever lost the session and quietly rebuilt one, these tests would still
 * "pass" a naive assertion on `actions` — so they assert on the fake's call
 * counts too. A rebuilt graph would fetch the backlog and call the model a
 * second time; the real one calls neither.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { startTriage } from "../../lib/agent";
import type {
  Assessment,
  BacklogItem,
  PlannedAction,
  RepoConfig,
  TriageDeps,
} from "../../lib/agent/types";
import {
  TriageJobError,
  adoptTriageSession,
  getTriageJob,
  latestTriageJobForProject,
  normalizeDecisions,
  resetTriageJobs,
  resumeTriageJob,
  type TriageJob,
} from "../../lib/triage-jobs";

const REPO: RepoConfig = { owner: "acme", repo: "widgets" };

function item(number: number): BacklogItem {
  return {
    number,
    title: `issue ${number}`,
    body: `body ${number}`,
    labels: [],
    createdAt: "2026-01-01T00:00:00Z",
    url: `https://github.com/acme/widgets/issues/${number}`,
  };
}

type Spy = {
  deps: TriageDeps;
  backlogCalls: number;
  assessCalls: number;
  applied: PlannedAction[];
};

function spyDeps(
  numbers: number[],
  verdicts: Record<number, Assessment["recommendation"]> = {},
): Spy {
  const spy: Spy = {
    backlogCalls: 0,
    assessCalls: 0,
    applied: [],
    deps: {
      async listBacklog() {
        spy.backlogCalls += 1;
        return numbers.map(item);
      },
      async assessBatch(batch) {
        spy.assessCalls += 1;
        return batch.map((b) => ({
          number: b.number,
          recommendation: verdicts[b.number] ?? "approve",
          reason: `because ${b.number}`,
          confidence: 0.8,
        }));
      },
      async applyAction(_repo, action) {
        spy.applied.push(action);
      },
    },
  };
  return spy;
}

/**
 * Park a halted run in the store without going through `startTriageJob`, which
 * always reaches for the real GitHub + LLM deps. Everything AFTER the halt —
 * which is the part this file cares about — is identical either way.
 */
async function parkRun(spy: Spy, id = "triage-test"): Promise<TriageJob> {
  const session = await startTriage({
    repo: REPO,
    limit: 10,
    apply: false,
    deps: spy.deps,
    threadId: id,
  });
  const job: TriageJob = {
    id,
    projectKey: "widgets",
    repo: REPO,
    limit: 10,
    status: "awaiting-decisions",
    backend: "fake",
    model: "fake",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    haltedAt: Date.now(),
    proposals: session.proposals,
    decisions: [],
    actions: [],
    applied: false,
  };
  adoptTriageSession(job, session);
  return job;
}

beforeEach(() => resetTriageJobs());

describe("the paused graph survives across calls", () => {
  it("resumes the same parked graph — no second backlog fetch, no second model call", async () => {
    const spy = spyDeps([1, 2, 3]);
    const job = await parkRun(spy);

    // One pass to the interrupt: one fetch, one batched assessment.
    expect(spy.backlogCalls).toBe(1);
    expect(spy.assessCalls).toBe(1);
    expect(job.proposals.map((p) => p.number)).toEqual([1, 2, 3]);

    // A separate "request" later, holding nothing but the id.
    const finished = await resumeTriageJob(
      job.id,
      [
        { number: 1, action: "approve" },
        { number: 2, action: "decline" },
        { number: 3, action: "skip" },
      ],
      false,
    );

    expect(finished.status).toBe("done");
    // The load never re-ran. This is the assertion that fails if the store ever
    // starts a fresh graph instead of resuming the parked one.
    expect(spy.backlogCalls).toBe(1);
    expect(spy.assessCalls).toBe(1);
    expect(finished.actions.map((a) => a.summary)).toEqual([
      '#1 → add label "approved"',
      '#2 → add label "declined"',
      "#3 → skipped (no action)",
    ]);
  });

  it("keeps dry-run the default: resuming without apply writes nothing", async () => {
    const spy = spyDeps([1, 2]);
    const job = await parkRun(spy);

    const finished = await resumeTriageJob(job.id, [
      { number: 1, action: "approve" },
      { number: 2, action: "needs-info" },
    ]);

    expect(spy.applied).toEqual([]);
    expect(finished.applied).toBe(false);
    expect(finished.actions.every((a) => a.applied === false)).toBe(true);
  });

  it("writes only when apply is explicitly true", async () => {
    const spy = spyDeps([1, 2]);
    const job = await parkRun(spy);

    const finished = await resumeTriageJob(
      job.id,
      [
        { number: 1, action: "approve" },
        { number: 2, action: "skip" },
      ],
      true,
    );

    // `skip` produces a `none` action, which is never handed to applyAction.
    expect(spy.applied.map((a) => a.summary)).toEqual(['#1 → add label "approved"']);
    expect(finished.applied).toBe(true);
    expect(finished.actions[0]?.applied).toBe(true);
  });

  it("lets the human's decision change the outcome", async () => {
    // The model says approve for every issue in both runs. The two humans say
    // different things, and only that difference moves the actions.
    const a = spyDeps([7]);
    const jobA = await parkRun(a, "triage-human-a");
    const doneA = await resumeTriageJob(jobA.id, [{ number: 7, action: "approve" }]);

    const b = spyDeps([7]);
    const jobB = await parkRun(b, "triage-human-b");
    const doneB = await resumeTriageJob(jobB.id, [
      { number: 7, action: "needs-info", note: "what does done look like?" },
    ]);

    expect(jobA.proposals[0]?.recommendation).toBe("approve");
    expect(jobB.proposals[0]?.recommendation).toBe("approve");
    expect(doneA.actions[0]?.kind).toBe("add-label");
    expect(doneB.actions[0]?.kind).toBe("comment");
    expect(doneB.actions[0]?.detail).toBe("what does done look like?");
  });
});

describe("refusals", () => {
  it("404s an unknown run rather than silently starting one", async () => {
    await expect(resumeTriageJob("nope", [{ number: 1, action: "approve" }])).rejects.toMatchObject(
      { httpStatus: 404 },
    );
  });

  it("refuses to resume the same run twice", async () => {
    const spy = spyDeps([1]);
    const job = await parkRun(spy);
    await resumeTriageJob(job.id, [{ number: 1, action: "approve" }]);
    await expect(resumeTriageJob(job.id, [{ number: 1, action: "approve" }])).rejects.toBeInstanceOf(
      TriageJobError,
    );
    // …and applying it twice cannot double-label the issue.
    expect(spy.applied).toEqual([]);
  });

  it("refuses to resume a run that has not halted yet", async () => {
    const job: TriageJob = {
      id: "triage-running",
      projectKey: "widgets",
      repo: REPO,
      limit: 10,
      status: "running",
      backend: "fake",
      model: "fake",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      proposals: [],
      decisions: [],
      actions: [],
      applied: false,
    };
    // No session: the graph has not reached the interrupt.
    adoptTriageSession(job, undefined as never);
    await expect(resumeTriageJob(job.id, [{ number: 1, action: "approve" }])).rejects.toMatchObject({
      httpStatus: 409,
    });
  });
});

describe("lookup", () => {
  it("finds the newest run for a project and ignores other projects'", async () => {
    const spy = spyDeps([1]);
    const older = await parkRun(spy, "triage-old");
    older.createdAt -= 10_000;
    const newer = await parkRun(spyDeps([2]), "triage-new");
    const other = await parkRun(spyDeps([3]), "triage-other");
    other.projectKey = "something-else";

    expect(latestTriageJobForProject("widgets")?.id).toBe(newer.id);
    expect(latestTriageJobForProject("something-else")?.id).toBe(other.id);
    expect(latestTriageJobForProject("nobody")).toBeNull();
    expect(getTriageJob("triage-old")?.id).toBe("triage-old");
  });
});

describe("normalizeDecisions", () => {
  const proposals = [1, 2].map((n) => ({
    ...item(n),
    recommendation: "approve" as const,
    reason: "r",
    confidence: 0.5,
  }));

  it("keeps well-formed decisions and trims notes", () => {
    expect(
      normalizeDecisions(proposals, [
        { number: 1, action: "decline" },
        { number: 2, action: "needs-info", note: "  more detail please  " },
      ]),
    ).toEqual([
      { number: 1, action: "decline" },
      { number: 2, action: "needs-info", note: "more detail please" },
    ]);
  });

  it("drops issues that are not in THIS run — a crafted body cannot reach #999", () => {
    expect(normalizeDecisions(proposals, [{ number: 999, action: "approve" }])).toEqual([]);
  });

  it("drops an unknown action rather than coercing it", () => {
    // Coercing to "skip" would silently downgrade; coercing to the model's
    // recommendation would silently promote. Neither is the owner's decision.
    expect(normalizeDecisions(proposals, [{ number: 1, action: "merge" }])).toEqual([]);
  });

  it("survives junk", () => {
    expect(normalizeDecisions(proposals, null)).toEqual([]);
    expect(normalizeDecisions(proposals, "approve everything")).toEqual([]);
    expect(normalizeDecisions(proposals, [null, 4, { number: "x", action: "approve" }])).toEqual([]);
  });

  it("caps a note so a comment body cannot be unbounded", () => {
    const [only] = normalizeDecisions(proposals, [
      { number: 1, action: "needs-info", note: "x".repeat(5000) },
    ]);
    expect(only?.note?.length).toBe(2000);
  });

  it("keeps the last decision when an issue appears twice", () => {
    expect(
      normalizeDecisions(proposals, [
        { number: 1, action: "approve" },
        { number: 1, action: "decline" },
      ]),
    ).toEqual([{ number: 1, action: "decline" }]);
  });
});
