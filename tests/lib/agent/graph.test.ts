/**
 * Triage-agent tests.
 *
 * No network and no LLM: every test injects a fake `TriageDeps`, so
 * lib/github.ts and lib/map-ai.ts are never even imported.
 */

import { describe, expect, it } from "vitest";
import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";

import { buildTriageGraph, chunk, normalizeResume, planAction } from "../../../lib/agent/graph";
import { coerceAssessments } from "../../../lib/agent/deps";
import type {
  Assessment,
  BacklogItem,
  PlannedAction,
  Proposal,
  RepoConfig,
  ReviewRequest,
  TriageDeps,
} from "../../../lib/agent/types";

const REPO: RepoConfig = { owner: "acme", repo: "widgets" };

function item(number: number, title: string): BacklogItem {
  return {
    number,
    title,
    body: `body of ${number}`,
    labels: [],
    createdAt: "2026-01-01T00:00:00Z",
    url: `https://github.com/acme/widgets/issues/${number}`,
  };
}

type Spy = {
  deps: TriageDeps;
  assessCalls: number[][];
  applied: PlannedAction[];
};

function fakeDeps(items: BacklogItem[], verdicts: Record<number, Assessment["recommendation"]> = {}): Spy {
  const assessCalls: number[][] = [];
  const applied: PlannedAction[] = [];
  return {
    assessCalls,
    applied,
    deps: {
      async listBacklog() {
        return items;
      },
      async assessBatch(batch) {
        assessCalls.push(batch.map((b) => b.number));
        return batch.map((b) => ({
          number: b.number,
          recommendation: verdicts[b.number] ?? "approve",
          reason: `because ${b.number}`,
          confidence: 0.8,
        }));
      },
      async applyAction(_repo, action) {
        applied.push(action);
      },
    },
  };
}

const cfg = (id: string) => ({ configurable: { thread_id: id } });

describe("triage graph — construction", () => {
  it("builds and compiles with the four expected nodes", () => {
    const graph = buildTriageGraph(fakeDeps([]).deps);
    const nodes = Object.keys(graph.nodes ?? {});
    for (const n of ["load_backlog", "assess", "propose", "apply_decisions"]) {
      expect(nodes).toContain(n);
    }
  });
});

describe("triage graph — human-in-the-loop interrupt", () => {
  it("genuinely halts at the interrupt, before applying anything", async () => {
    const spy = fakeDeps([item(1, "Add dark mode"), item(2, "Rewrite in Rust")], {
      2: "decline",
    });
    const graph = buildTriageGraph(spy.deps);

    const paused = await graph.invoke({ repo: REPO, limit: 10 }, cfg("t-halt"));

    // The run stopped rather than completing.
    expect(isInterrupted<ReviewRequest>(paused)).toBe(true);
    // apply_decisions never got past interrupt(), so no actions exist yet.
    expect(paused.actions ?? []).toEqual([]);
    expect(paused.decisions ?? []).toEqual([]);
    expect(spy.applied).toEqual([]);

    // The payload handed to the human carries the proposals.
    const review = (paused as unknown as Record<string, { value: ReviewRequest }[]>)[INTERRUPT][0]
      .value;
    expect(review.kind).toBe("triage-review");
    expect(review.proposals.map((p: Proposal) => p.number)).toEqual([1, 2]);
    expect(review.proposals[1].recommendation).toBe("decline");

    // And the checkpointer really is holding a paused run.
    const snapshot = await graph.getState(cfg("t-halt"));
    expect(snapshot.next).toContain("apply_decisions");
  });

  it("resumes with the human's decisions via Command({ resume })", async () => {
    const spy = fakeDeps([item(1, "Add dark mode"), item(2, "Rewrite in Rust")]);
    const graph = buildTriageGraph(spy.deps);

    const paused = await graph.invoke({ repo: REPO, limit: 10 }, cfg("t-resume"));
    expect(isInterrupted(paused)).toBe(true);

    // The human overrides the model on #1 and skips #2.
    const done = await graph.invoke(
      new Command({
        resume: [
          { number: 1, action: "decline" as const },
          { number: 2, action: "skip" as const },
        ],
      }),
      cfg("t-resume"),
    );

    expect(isInterrupted(done)).toBe(false);
    expect(done.decisions).toHaveLength(2);
    expect(done.actions.map((a: PlannedAction) => a.summary)).toEqual([
      '#1 → add label "declined"',
      "#2 → skipped (no action)",
    ]);

    const snapshot = await graph.getState(cfg("t-resume"));
    expect(snapshot.next).toEqual([]);
  });

  it("dry-runs by default: nothing is written to GitHub", async () => {
    const spy = fakeDeps([item(1, "Add dark mode")]);
    const graph = buildTriageGraph(spy.deps);

    await graph.invoke({ repo: REPO, limit: 5 }, cfg("t-dry"));
    const done = await graph.invoke(
      new Command({ resume: [{ number: 1, action: "approve" as const }] }),
      cfg("t-dry"),
    );

    expect(spy.applied).toEqual([]);
    expect(done.actions[0].applied).toBe(false);
    expect(done.actions[0].detail).toBe("approved");
  });

  it("writes to GitHub only when apply:true is passed", async () => {
    const spy = fakeDeps([item(1, "Add dark mode"), item(2, "Vague idea")]);
    const graph = buildTriageGraph(spy.deps);

    await graph.invoke({ repo: REPO, limit: 5, apply: true }, cfg("t-apply"));
    const done = await graph.invoke(
      new Command({
        resume: [
          { number: 1, action: "approve" as const },
          { number: 2, action: "needs-info" as const, note: "What does done look like?" },
        ],
      }),
      cfg("t-apply"),
    );

    expect(spy.applied).toHaveLength(2);
    expect(spy.applied[0].kind).toBe("add-label");
    expect(spy.applied[1].kind).toBe("comment");
    expect(spy.applied[1].detail).toBe("What does done look like?");
    expect(done.actions.every((a: PlannedAction) => a.applied)).toBe(true);
  });

  it("batches assessment into a few calls, not one per issue", async () => {
    const items = Array.from({ length: 23 }, (_, i) => item(i + 1, `Issue ${i + 1}`));
    const spy = fakeDeps(items);
    const graph = buildTriageGraph(spy.deps);

    await graph.invoke({ repo: REPO, limit: 25 }, cfg("t-batch"));

    expect(spy.assessCalls.map((c) => c.length)).toEqual([10, 10, 3]);
  });

  it("skips items the human did not rule on", async () => {
    const spy = fakeDeps([item(1, "A"), item(2, "B")]);
    const graph = buildTriageGraph(spy.deps);

    await graph.invoke({ repo: REPO, limit: 5, apply: true }, cfg("t-partial"));
    const done = await graph.invoke(
      new Command({ resume: [{ number: 1, action: "approve" as const }] }),
      cfg("t-partial"),
    );

    expect(spy.applied).toHaveLength(1);
    expect(done.actions[1].kind).toBe("none");
  });
});

describe("triage helpers", () => {
  it("chunk splits evenly and keeps the remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });

  it("normalizeResume accepts both an array and a {decisions} wrapper", () => {
    const d = [{ number: 1, action: "approve" as const }];
    expect(normalizeResume(d)).toEqual(d);
    expect(normalizeResume({ decisions: d })).toEqual(d);
    expect(normalizeResume(null)).toEqual([]);
  });

  it("planAction maps each decision to the right GitHub write", () => {
    const p: Proposal = {
      ...item(7, "Thing"),
      recommendation: "needs-info",
      reason: "unclear scope",
      confidence: 0.4,
    };
    expect(planAction(p, { number: 7, action: "approve" }).detail).toBe("approved");
    expect(planAction(p, { number: 7, action: "decline" }).detail).toBe("declined");
    expect(planAction(p, { number: 7, action: "needs-info" }).detail).toContain("unclear scope");
    expect(planAction(p, { number: 7, action: "skip" }).kind).toBe("none");
  });

  it("coerceAssessments drops junk and clamps confidence", () => {
    const items = [item(1, "A"), item(2, "B")];
    const out = coerceAssessments(
      {
        assessments: [
          { number: 1, recommendation: "approve", reason: "ok", confidence: 5 },
          { number: 99, recommendation: "approve", reason: "not ours", confidence: 1 },
          { number: 2, recommendation: "nonsense", reason: "", confidence: "x" },
        ],
      },
      items,
    );
    expect(out).toEqual([
      { number: 1, recommendation: "approve", reason: "ok", confidence: 1 },
      { number: 2, recommendation: "needs-info", reason: "No reason given.", confidence: 0 },
    ]);
    expect(coerceAssessments({}, items)).toEqual([]);
  });
});
