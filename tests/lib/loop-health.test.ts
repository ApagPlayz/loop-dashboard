/**
 * The loop preflight's judgement.
 *
 * The thing worth pinning here is not that the checks call GitHub — it is what
 * the readings are allowed to MEAN. Two rules carry the whole feature:
 *
 *   1. A check that could not be performed never becomes "healthy". The
 *      three-state secret read (`true` / `false` / `null`) is where that is
 *      most likely to be quietly broken by a future edit — collapsing `null`
 *      into `false` would tell an owner their token is missing when the only
 *      thing missing is the PAT's permission to look.
 *   2. One failing project never sinks the sweep.
 *
 * `deriveHealth` is a pure function of a `LoopProbe` precisely so those rules
 * can be tested directly instead of through a mock of the GitHub API. The one
 * place a mock is unavoidable — the sweep's resilience — mocks the modules
 * `lib/loop-health.ts` imports, so no test in this file touches the network.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  countFailureStreak,
  deriveAppProof,
  deriveHealth,
  type LoopProbe,
  type RunSummary,
} from "../../lib/loop-health";
import type { WorkflowPower } from "../../lib/map-power";
import type { TemplateDrift } from "../../lib/loop-template";

const PROJECT = {
  key: "content-generation-platform",
  label: "Content Generation Platform",
  owner: "ApagPlayz",
  repo: "content-generation-platform",
};

const AT = "2026-09-08T12:00:00.000Z";

function workflow(file: string, enabled = true): WorkflowPower {
  return {
    file,
    name: file.replace(/^claude-|\.yml$/g, ""),
    state: enabled ? "active" : "disabled_manually",
    enabled,
    isMention: file === "claude-mention.yml",
  };
}

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 1,
    workflowFile: "claude-scout.yml",
    workflowName: "Scout",
    status: "completed",
    conclusion: "success",
    htmlUrl: "https://github.com/o/r/actions/runs/1",
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

/** A probe where every check ran and every answer is good. */
function healthyProbe(over: Partial<LoopProbe> = {}): LoopProbe {
  return {
    secret: true,
    workflows: [workflow("claude-scout.yml"), workflow("claude-builder.yml")],
    runs: new Map([
      ["claude-scout.yml", [run()]],
      ["claude-builder.yml", [run({ id: 2, workflowFile: "claude-builder.yml" })]],
    ]),
    drift: null,
    failures: [],
    ...over,
  };
}

function drift(over: Partial<TemplateDrift> = {}): TemplateDrift {
  return {
    project: PROJECT.key,
    inSync: true,
    counts: {
      identical: 2,
      "repo-behind-or-diverged": 0,
      "missing-in-repo": 0,
      "extra-in-repo": 0,
    },
    files: [],
    templateEmpty: false,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Verdicts                                                            */
/* ------------------------------------------------------------------ */

describe("verdicts", () => {
  it("is healthy only when every check ran and found nothing", () => {
    const health = deriveHealth(PROJECT, healthyProbe({ drift: drift() }), AT);
    expect(health.verdict).toBe("healthy");
    expect(health.faults).toEqual([]);
    expect(health.checkedAt).toBe(AT);
    expect(health.owner).toBe("ApagPlayz");
  });

  it("is blocked when the token secret is confirmed missing", () => {
    const health = deriveHealth(PROJECT, healthyProbe({ secret: false }), AT);
    expect(health.verdict).toBe("blocked");
    expect(health.faults).toContainEqual({ kind: "missing-token" });
  });

  it("is blocked when EVERY claude workflow is disabled", () => {
    const probe = healthyProbe({
      workflows: [workflow("claude-scout.yml", false), workflow("claude-builder.yml", false)],
    });
    const health = deriveHealth(PROJECT, probe, AT);
    expect(health.verdict).toBe("blocked");
    expect(health.faults).toContainEqual({
      kind: "workflows-disabled",
      files: ["claude-scout.yml", "claude-builder.yml"],
      names: ["scout", "builder"],
    });
  });

  it("is only degraded when SOME workflows are disabled — the motivating 7-of-8 case", () => {
    const files = [
      "claude-scout.yml",
      "claude-builder.yml",
      "claude-reviewer.yml",
      "claude-mention.yml",
      "claude-triage.yml",
      "claude-docs.yml",
      "claude-metrics.yml",
      "claude-release.yml",
    ];
    const probe = healthyProbe({
      workflows: files.map((f, i) => workflow(f, i === 0)),
      runs: new Map(files.map((f) => [f, [run({ workflowFile: f })]])),
    });
    const health = deriveHealth(PROJECT, probe, AT);
    expect(health.verdict).toBe("degraded");
    const fault = health.faults.find((f) => f.kind === "workflows-disabled");
    expect(fault?.kind).toBe("workflows-disabled");
    expect(fault?.kind === "workflows-disabled" ? fault.files : []).toHaveLength(7);
  });

  it("counts only claude-* workflows, so loop-metrics.yml being off is not the loop being off", () => {
    // listLoopWorkflows also returns loop-metrics.yml. If it were counted, a
    // repo whose only disabled workflow was the metrics collector would read as
    // "every workflow disabled" — i.e. blocked — which is wrong.
    const probe = healthyProbe({
      workflows: [workflow("claude-scout.yml"), workflow("loop-metrics.yml", false)],
      runs: new Map([["claude-scout.yml", [run()]]]),
    });
    const health = deriveHealth(PROJECT, probe, AT);
    expect(health.verdict).toBe("healthy");
  });

  it("is degraded on template drift, listing the files that need updating", () => {
    const probe = healthyProbe({
      drift: drift({
        inSync: false,
        files: [
          { file: "claude-scout.yml", status: "repo-behind-or-diverged", diff: "…" },
          { file: "claude-new.yml", status: "missing-in-repo", diff: "…" },
          { file: "claude-old.yml", status: "extra-in-repo", diff: "…" },
          { file: "claude-builder.yml", status: "identical", diff: "" },
        ],
      }),
    });
    const health = deriveHealth(PROJECT, probe, AT);
    expect(health.verdict).toBe("degraded");
    // "extra-in-repo" is a custom agent the template doesn't know about, not
    // drift the owner has to fix — it must not appear here.
    expect(health.faults).toContainEqual({
      kind: "template-drift",
      files: ["claude-scout.yml", "claude-new.yml"],
    });
  });

  it("ignores drift entirely when the template itself is empty", () => {
    const probe = healthyProbe({
      drift: drift({ inSync: false, templateEmpty: true, files: [] }),
    });
    expect(deriveHealth(PROJECT, probe, AT).verdict).toBe("healthy");
  });

  it("keeps `blocked` as the headline even when another check also failed", () => {
    // A definite, actionable, run-preventing fact outranks "and we couldn't
    // check one other thing". It can only ever come from a check that SUCCEEDED,
    // so it never rests on a guess.
    const probe = healthyProbe({
      secret: false,
      drift: null,
      failures: [{ what: "template-drift", detail: "rate limited" }],
    });
    const health = deriveHealth(PROJECT, probe, AT);
    expect(health.verdict).toBe("blocked");
    expect(health.faults.map((f) => f.kind)).toContain("check-failed");
  });

  it("prefers `unknown` over `degraded` when something could not be checked", () => {
    const probe = healthyProbe({
      workflows: [workflow("claude-scout.yml", false), workflow("claude-builder.yml")],
      failures: [{ what: "runs", detail: "502" }],
      runs: null,
    });
    expect(deriveHealth(PROJECT, probe, AT).verdict).toBe("unknown");
  });

  it("calls a repo with no claude-* workflows unknown, not disabled and not healthy", () => {
    // A repo that never had the loop installed is not a repo whose agents are
    // switched off. Reporting `workflows-disabled` with an empty list would be
    // a lie; reporting healthy would be worse.
    const probe = healthyProbe({ workflows: [], runs: new Map() });
    const health = deriveHealth(PROJECT, probe, AT);
    expect(health.verdict).toBe("unknown");
    expect(health.faults.some((f) => f.kind === "workflows-disabled")).toBe(false);
    const failed = health.faults.find((f) => f.kind === "check-failed");
    expect(failed?.kind === "check-failed" ? failed.what : null).toBe("workflows");
  });
});

/* ------------------------------------------------------------------ */
/* The three-state secret                                              */
/* ------------------------------------------------------------------ */

describe("the secret check keeps all three states apart", () => {
  it("true — no fault", () => {
    expect(deriveHealth(PROJECT, healthyProbe({ secret: true }), AT).verdict).toBe("healthy");
  });

  it("false — missing-token, blocked", () => {
    const health = deriveHealth(PROJECT, healthyProbe({ secret: false }), AT);
    expect(health.faults).toContainEqual({ kind: "missing-token" });
    expect(health.verdict).toBe("blocked");
  });

  it("null — check-failed and unknown, NEVER missing-token", () => {
    // This is the assertion the whole three-state design exists for. `null`
    // means "the PAT wasn't allowed to look at the secrets list", which is not
    // evidence about the secret. Telling the owner to go re-add a token that is
    // already there would send them chasing a fault that does not exist.
    const probe = healthyProbe({
      secret: null,
      failures: [{ what: "secret", detail: "Couldn't read this repo's Actions secrets." }],
    });
    const health = deriveHealth(PROJECT, probe, AT);
    expect(health.faults.some((f) => f.kind === "missing-token")).toBe(false);
    expect(health.verdict).toBe("unknown");
    const failed = health.faults.find((f) => f.kind === "check-failed");
    expect(failed?.kind === "check-failed" ? failed.what : null).toBe("secret");
  });
});

/* ------------------------------------------------------------------ */
/* Failure streaks                                                     */
/* ------------------------------------------------------------------ */

describe("countFailureStreak", () => {
  const failed = (id: number, conclusion = "failure") =>
    run({ id, conclusion, createdAt: `2026-09-0${id}T00:00:00Z` });

  it("counts consecutive failures from the most recent run backwards", () => {
    expect(countFailureStreak([failed(3), failed(2), failed(1)])).toBe(3);
  });

  it("stops at the first success", () => {
    expect(countFailureStreak([failed(3), failed(2), run({ conclusion: "success" })])).toBe(2);
  });

  it("returns 0 when the latest run is green", () => {
    expect(countFailureStreak([run({ conclusion: "success" }), failed(2), failed(1)])).toBe(0);
  });

  it("treats timed_out and startup_failure as failures", () => {
    // startup_failure is the classic symptom of a missing token — the job dies
    // before the agent step ever runs.
    expect(
      countFailureStreak([failed(3, "timed_out"), failed(2, "startup_failure")]),
    ).toBe(2);
  });

  it("scans PAST cancelled and skipped without counting or clearing them", () => {
    // A cancelled run is a human hitting the button or a concurrency supersede;
    // a skipped one is an `if:` that declined. Neither is evidence the agent
    // works, so neither may clear a real streak — and neither is evidence it is
    // broken, so neither may manufacture one.
    expect(
      countFailureStreak([failed(4), run({ conclusion: "cancelled" }), failed(2)]),
    ).toBe(2);
    expect(
      countFailureStreak([run({ conclusion: "cancelled" }), run({ conclusion: "skipped" })]),
    ).toBe(0);
    // …and a success still behind them ends the streak as normal.
    expect(
      countFailureStreak([
        failed(4),
        run({ conclusion: "skipped" }),
        run({ conclusion: "success" }),
        failed(1),
      ]),
    ).toBe(1);
  });

  it("skips runs that have not finished", () => {
    expect(
      countFailureStreak([
        run({ status: "in_progress", conclusion: null }),
        failed(2),
        failed(1),
      ]),
    ).toBe(2);
  });

  it("is 0 for a workflow with no runs at all", () => {
    expect(countFailureStreak([])).toBe(0);
  });
});

describe("runs-failing faults", () => {
  it("stays silent at a streak of one, because one red run is noise", () => {
    const probe = healthyProbe({
      runs: new Map([
        ["claude-scout.yml", [run({ conclusion: "failure" }), run({ conclusion: "success" })]],
        ["claude-builder.yml", [run({ workflowFile: "claude-builder.yml" })]],
      ]),
    });
    const health = deriveHealth(PROJECT, probe, AT);
    expect(health.faults.some((f) => f.kind === "runs-failing")).toBe(false);
    expect(health.verdict).toBe("healthy");
  });

  it("raises one fault per failing workflow at a streak of two, with the latest run's URL", () => {
    const probe = healthyProbe({
      runs: new Map([
        [
          "claude-scout.yml",
          [
            run({ id: 9, conclusion: "failure", htmlUrl: "https://x/9", createdAt: "2026-09-05T00:00:00Z" }),
            run({ id: 8, conclusion: "failure", createdAt: "2026-09-04T00:00:00Z" }),
          ],
        ],
        ["claude-builder.yml", [run({ workflowFile: "claude-builder.yml" })]],
      ]),
    });
    const health = deriveHealth(PROJECT, probe, AT);
    expect(health.verdict).toBe("degraded");
    expect(health.faults).toContainEqual({
      kind: "runs-failing",
      workflowFile: "claude-scout.yml",
      workflowName: "scout",
      streak: 2,
      lastRunUrl: "https://x/9",
      // Carried straight off the run rather than regexed back out of the URL,
      // so the re-run repair keeps working if GitHub's URL shape ever changes.
      lastRunId: 9,
    });
  });
});

/* ------------------------------------------------------------------ */
/* App proof                                                           */
/* ------------------------------------------------------------------ */

describe("deriveAppProof", () => {
  it("proves the app from the most recent SUCCESSFUL claude run", () => {
    const proof = deriveAppProof([
      run({ id: 1, conclusion: "failure", createdAt: "2026-09-06T00:00:00Z" }),
      run({ id: 2, conclusion: "success", htmlUrl: "https://x/2", createdAt: "2026-09-05T00:00:00Z" }),
      run({ id: 3, conclusion: "success", htmlUrl: "https://x/3", createdAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(proof).toEqual({
      proven: true,
      runUrl: "https://x/2",
      at: "2026-09-05T00:00:00Z",
    });
  });

  it("is not proven by a green run of a NON-claude workflow", () => {
    // The repo's own CI passing says nothing about whether the Claude GitHub
    // App is installed.
    expect(
      deriveAppProof([run({ workflowFile: "ci.yml", conclusion: "success" })]),
    ).toEqual({ proven: false, runUrl: null, at: null });
  });

  it("is not proven when every claude run failed", () => {
    expect(
      deriveAppProof([
        run({ conclusion: "failure" }),
        run({ conclusion: "startup_failure" }),
      ]),
    ).toEqual({ proven: false, runUrl: null, at: null });
  });

  it("raises app-unproven only when the run history was actually readable", () => {
    const never = deriveHealth(
      PROJECT,
      healthyProbe({
        runs: new Map([["claude-scout.yml", [run({ conclusion: "failure" })]]]),
      }),
      AT,
    );
    expect(never.appProof.proven).toBe(false);
    expect(never.faults).toContainEqual({ kind: "app-unproven" });

    // Unreadable history: `proven: false` here means "we could not establish
    // it", not "it is disproved" — so no fault, and the verdict says unknown.
    const unreadable = deriveHealth(
      PROJECT,
      healthyProbe({ runs: null, failures: [{ what: "runs", detail: "502" }] }),
      AT,
    );
    expect(unreadable.faults.some((f) => f.kind === "app-unproven")).toBe(false);
    expect(unreadable.verdict).toBe("unknown");
  });

  it("carries the proof onto the health record", () => {
    const health = deriveHealth(
      PROJECT,
      healthyProbe({
        runs: new Map([
          ["claude-scout.yml", [run({ htmlUrl: "https://x/1", createdAt: "2026-09-02T00:00:00Z" })]],
        ]),
        workflows: [workflow("claude-scout.yml")],
      }),
      AT,
    );
    expect(health.appProof).toEqual({
      proven: true,
      runUrl: "https://x/1",
      at: "2026-09-02T00:00:00Z",
    });
  });
});

/* ------------------------------------------------------------------ */
/* The sweep                                                           */
/* ------------------------------------------------------------------ */

/**
 * The only mocked test in the file. Everything below the sweep is already
 * covered purely; what is left to prove is the isolation property — one
 * project blowing up must not take the others with it.
 */
const PROJECTS = [
  { key: "good", owner: "o", repo: "good", label: "Good", addedAt: AT },
  { key: "bad", owner: "o", repo: "bad", label: "Bad", addedAt: AT },
  { key: "also-good", owner: "o", repo: "also-good", label: "Also Good", addedAt: AT },
];

vi.mock("../../lib/projects", () => ({
  listProjects: vi.fn(async () => PROJECTS),
  ProjectError: class ProjectError extends Error {},
}));

vi.mock("../../lib/map-power", () => ({
  listLoopWorkflows: vi.fn(async (repo: { repo: string }) => {
    if (repo.repo === "bad") throw Object.assign(new Error("Bad credentials"), { status: 401 });
    return [
      {
        file: "claude-scout.yml",
        name: "Scout",
        state: "active",
        enabled: true,
        isMention: false,
      },
    ];
  }),
  setWorkflowEnabled: vi.fn(),
}));

vi.mock("../../lib/loop-template", () => ({
  computeTemplateDrift: vi.fn(async (key: string) => ({
    project: key,
    inSync: true,
    counts: { identical: 1, "repo-behind-or-diverged": 0, "missing-in-repo": 0, "extra-in-repo": 0 },
    files: [],
    templateEmpty: false,
  })),
}));

vi.mock("../../lib/github", () => ({
  getOctokit: vi.fn(() => ({
    rest: {
      actions: {
        listRepoSecrets: vi.fn(async ({ repo }: { repo: string }) => {
          if (repo === "bad") throw Object.assign(new Error("Not Found"), { status: 404 });
          return { data: { secrets: [{ name: "CLAUDE_CODE_OAUTH_TOKEN" }] } };
        }),
      },
    },
  })),
  getWorkflowRuns: vi.fn(async ({ repo }: { repo: { repo: string } }) => {
    if (repo.repo === "bad") throw Object.assign(new Error("Server Error"), { status: 500 });
    return [
      {
        id: 1,
        path: ".github/workflows/claude-scout.yml",
        name: "Scout",
        status: "completed",
        conclusion: "success",
        html_url: "https://x/1",
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
  }),
}));

describe("sweepLoopHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns every project even when one of them fails every check", async () => {
    const { sweepLoopHealth } = await import("../../lib/loop-health");
    const payload = await sweepLoopHealth({ force: true });

    expect(payload.projects.map((p) => p.projectKey)).toEqual(["good", "bad", "also-good"]);
    expect(payload.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const good = payload.projects.filter((p) => p.projectKey !== "bad");
    for (const project of good) {
      expect(project.verdict).toBe("healthy");
      expect(project.appProof.proven).toBe(true);
    }

    const bad = payload.projects.find((p) => p.projectKey === "bad")!;
    expect(bad.verdict).toBe("unknown");
    // Every check failed independently, and each says which one and why.
    const what = bad.faults
      .filter((f) => f.kind === "check-failed")
      .map((f) => (f.kind === "check-failed" ? f.what : ""));
    expect(what).toEqual(expect.arrayContaining(["secret", "workflows", "runs"]));
    // Crucially: not blamed on a missing token just because we couldn't look.
    expect(bad.faults.some((f) => f.kind === "missing-token")).toBe(false);
  });

  it("filters to one project when a key is given", async () => {
    const { sweepLoopHealth } = await import("../../lib/loop-health");
    const payload = await sweepLoopHealth({ projectKey: "good", force: true });
    expect(payload.projects.map((p) => p.projectKey)).toEqual(["good"]);
  });

  it("memoises a healthy result and re-reads on force", async () => {
    const { sweepLoopHealth } = await import("../../lib/loop-health");
    const { listLoopWorkflows } = await import("../../lib/map-power");

    await sweepLoopHealth({ projectKey: "good", force: true });
    const afterFirst = vi.mocked(listLoopWorkflows).mock.calls.length;
    await sweepLoopHealth({ projectKey: "good" });
    expect(vi.mocked(listLoopWorkflows).mock.calls.length).toBe(afterFirst);
    await sweepLoopHealth({ projectKey: "good", force: true });
    expect(vi.mocked(listLoopWorkflows).mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
