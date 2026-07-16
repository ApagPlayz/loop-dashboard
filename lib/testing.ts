/**
 * Server-side helpers for the Testing section.
 *
 * These extend lib/github.ts with the extra Actions endpoints the testing
 * views need (run jobs, job log tails, commit history for instruction files).
 * Everything here runs on the server (API routes / server components) where
 * GITHUB_TOKEN is available.
 */

import { getOctokit, REPOS } from "@/lib/github";

const { owner, repo } = REPOS.primary;

/* ------------------------------------------------------------------ */
/* Workflow registry                                                   */
/* ------------------------------------------------------------------ */

export type WorkflowInput = {
  /** GitHub workflow_dispatch input name, e.g. "issue_number". */
  name: string;
  /** Where the dropdown pulls its choices from. */
  source: "redraft-issues" | "claude-prs";
  label: string;
};

export type WorkflowDef = {
  /** The .yml filename (also the GitHub workflow_id). */
  file: string;
  /** Short stable key. */
  key: string;
  /** Friendly name. */
  name: string;
  /** Plain-English description of what a manual run does. */
  description: string;
  /** Can the owner trigger this by hand from the "Run an agent" panel? */
  runnable: boolean;
  /** Required workflow_dispatch input, if any. */
  input?: WorkflowInput;
};

/**
 * Every workflow the dashboard knows about. `runnable` marks the ones that
 * appear as "Run an agent now" cards; the rest run automatically (on PRs,
 * schedules, or repository_dispatch) and only show up in the runs table.
 */
export const WORKFLOWS: WorkflowDef[] = [
  {
    file: "claude-scout.yml",
    key: "scout",
    name: "Scout",
    description:
      "Looks for new work worth doing and files proposals for you to approve. Safe to run anytime — it never changes code.",
    runnable: true,
  },
  {
    file: "claude-builder.yml",
    key: "builder",
    name: "Builder",
    description:
      "Picks the best approved proposal and opens one pull request with the change. Normally runs overnight.",
    runnable: true,
  },
  {
    file: "claude-redraft.yml",
    key: "redraft",
    name: "Redraft a proposal",
    description:
      "Asks Claude to rewrite a proposal issue so it's clearer or better scoped. Pick which proposal below.",
    runnable: true,
    input: {
      name: "issue_number",
      source: "redraft-issues",
      label: "Which proposal to redraft",
    },
  },
  {
    file: "claude-demo.yml",
    key: "demo",
    name: "Capture demo evidence",
    description:
      "Runs the app for a pull request and captures screenshots / video so you can see the change working. Pick which PR below.",
    runnable: true,
    input: {
      name: "pr_number",
      source: "claude-prs",
      label: "Which pull request to demo",
    },
  },
  {
    file: "claude-retro.yml",
    key: "retro",
    name: "Retro",
    description:
      "Reviews how the loop has been doing lately and writes up lessons learned. Normally runs weekly.",
    runnable: true,
  },
  {
    file: "loop-metrics.yml",
    key: "metrics",
    name: "Refresh metrics",
    description:
      "Recounts the loop's numbers (merge rate, PR sizes, proposals) and saves a fresh daily snapshot. Normally runs daily.",
    runnable: true,
  },
  {
    file: "repo-tests.yml",
    key: "tests",
    name: "Test suite",
    description:
      "Runs the project's automated checks — install, lint, tests, and build — to confirm nothing is broken.",
    runnable: true,
  },
  {
    file: "claude-audit.yml",
    key: "audit",
    name: "Auditor",
    description:
      "Reviews every pull request automatically and posts a verdict. Runs on its own when a PR appears.",
    runnable: false,
  },
  {
    file: "claude-mention.yml",
    key: "mention",
    name: "@claude mention",
    description:
      "Wakes up when you write @claude in an issue or PR comment. Runs on its own.",
    runnable: false,
  },
  {
    file: "claude-tool-install.yml",
    key: "toolinstall",
    name: "Tool installer",
    description:
      "Installs a new skill / MCP server / plugin into an agent. Started from the Tools page.",
    runnable: false,
  },
];

export function findWorkflow(fileOrKey: string): WorkflowDef | undefined {
  return WORKFLOWS.find((w) => w.file === fileOrKey || w.key === fileOrKey);
}

/* ------------------------------------------------------------------ */
/* Runs, jobs, logs                                                    */
/* ------------------------------------------------------------------ */

export type RunSummary = {
  id: number;
  name: string;
  workflowFile: string | null;
  status: string | null; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | null
  createdAt: string;
  updatedAt: string;
  runStartedAt: string | null;
  htmlUrl: string;
  event: string;
  displayName: string; // friendly workflow name if we know it
};

function workflowFileFromPath(path: string | undefined | null): string | null {
  if (!path) return null;
  const m = path.match(/([^/]+\.ya?ml)$/);
  return m ? m[1] : null;
}

export function toRunSummary(run: {
  id: number;
  name?: string | null;
  path?: string;
  status?: string | null;
  conclusion?: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
  html_url: string;
  event: string;
}): RunSummary {
  const file = workflowFileFromPath(run.path);
  const def = file ? findWorkflow(file) : undefined;
  return {
    id: run.id,
    name: run.name ?? "",
    workflowFile: file,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    runStartedAt: run.run_started_at ?? null,
    htmlUrl: run.html_url,
    event: run.event,
    displayName: def?.name ?? run.name ?? file ?? "Workflow",
  };
}

export type JobStep = {
  name: string;
  status: string | null;
  conclusion: string | null;
  number: number;
};

export type JobSummary = {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
  steps: JobStep[];
};

export async function listRunJobs(runId: number): Promise<JobSummary[]> {
  const res = await getOctokit().rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
    per_page: 50,
  });
  return res.data.jobs.map((j) => ({
    id: j.id,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    startedAt: j.started_at ?? null,
    completedAt: j.completed_at ?? null,
    htmlUrl: j.html_url ?? null,
    steps: (j.steps ?? []).map((s) => ({
      name: s.name,
      status: s.status,
      conclusion: s.conclusion ?? null,
      number: s.number,
    })),
  }));
}

export type JobLogResult =
  | { available: true; tail: string; totalLines: number; htmlUrl: string | null }
  | { available: false; reason: string };

/**
 * Fetch the tail of a job's logs. GitHub only serves logs once a job has
 * finished (or partially, once steps complete); while it's still running the
 * endpoint 404s, in which case we report the logs aren't ready yet.
 */
export async function getJobLogTail(
  jobId: number,
  maxLines = 200,
): Promise<JobLogResult> {
  const octokit = getOctokit();
  try {
    const res = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
      { owner, repo, job_id: jobId },
    );
    const raw = res.data as unknown;
    const text =
      typeof raw === "string"
        ? raw
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw).toString("utf-8")
          : Buffer.from(raw as Uint8Array).toString("utf-8");
    const lines = text.split(/\r?\n/);
    const tail = lines.slice(-maxLines).join("\n");
    return { available: true, tail, totalLines: lines.length, htmlUrl: null };
  } catch (err: unknown) {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? (err as { status?: number }).status
        : undefined;
    if (status === 404) {
      return {
        available: false,
        reason: "Logs aren't ready yet — this job is still running.",
      };
    }
    if (status === 410) {
      return { available: false, reason: "Logs for this run have expired." };
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Dispatch option sources (dropdowns)                                 */
/* ------------------------------------------------------------------ */

export type Option = { value: string; label: string };

/** Open issues labeled `redraft` or `proposal` — choices for the Redraft run. */
export async function redraftIssueOptions(): Promise<Option[]> {
  const octokit = getOctokit();
  // listForRepo with comma labels is AND, so query each label and merge.
  const [prop, red] = await Promise.all([
    octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
      labels: "proposal",
      per_page: 50,
    }),
    octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
      labels: "redraft",
      per_page: 50,
    }),
  ]);
  const seen = new Set<number>();
  const out: Option[] = [];
  for (const i of [...prop.data, ...red.data]) {
    if (i.pull_request) continue;
    if (seen.has(i.number)) continue;
    seen.add(i.number);
    out.push({ value: String(i.number), label: `#${i.number} — ${i.title}` });
  }
  return out;
}

/** Open PRs from `claude/` branches — choices for the Demo run. */
export async function claudePrOptions(): Promise<Option[]> {
  const res = await getOctokit().rest.pulls.list({
    owner,
    repo,
    state: "open",
    per_page: 50,
  });
  return res.data
    .filter((pr) => pr.head?.ref?.startsWith("claude/"))
    .map((pr) => ({ value: String(pr.number), label: `#${pr.number} — ${pr.title}` }));
}

/* ------------------------------------------------------------------ */
/* Instruction change tracking                                         */
/* ------------------------------------------------------------------ */

export type InstructionCommit = {
  sha: string;
  message: string;
  author: string;
  date: string | null;
  htmlUrl: string;
  isDashboardEdit: boolean;
};

/**
 * Commits on main that touched a given workflow file, newest first.
 */
export async function listWorkflowCommits(
  path: string,
  perPage = 15,
): Promise<InstructionCommit[]> {
  const res = await getOctokit().rest.repos.listCommits({
    owner,
    repo,
    sha: "main",
    path,
    per_page: perPage,
  });
  return res.data.map((c) => {
    const message = c.commit.message.split("\n")[0];
    return {
      sha: c.sha,
      message,
      author: c.commit.author?.name ?? c.author?.login ?? "unknown",
      date: c.commit.author?.date ?? null,
      htmlUrl: c.html_url,
      isDashboardEdit: /^dashboard:\s*edit/i.test(message),
    };
  });
}

export type FilePatch = {
  filename: string;
  patch: string | null;
  additions: number;
  deletions: number;
};

/** Get the per-file patches for a commit, limited to workflow files. */
export async function getCommitWorkflowPatch(
  sha: string,
): Promise<{ message: string; files: FilePatch[] }> {
  const res = await getOctokit().rest.repos.getCommit({
    owner,
    repo,
    ref: sha,
  });
  const files = (res.data.files ?? [])
    .filter((f) => f.filename.startsWith(".github/workflows/"))
    .map((f) => ({
      filename: f.filename,
      patch: f.patch ?? null,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    }));
  return { message: res.data.commit.message.split("\n")[0], files };
}

/* ------------------------------------------------------------------ */
/* Before / after metrics comparison                                   */
/* ------------------------------------------------------------------ */

export type MetricSnapshot = {
  date: string;
  prs_opened?: number;
  prs_merged?: number;
  prs_rejected?: number;
  merge_rate_pct?: number | null;
  median_pr_size_lines?: number | null;
  proposals_filed?: number;
  proposals_approved?: number;
  proposal_approval_rate_pct?: number | null;
};

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function collect(
  rows: MetricSnapshot[],
  pick: (s: MetricSnapshot) => number | null | undefined,
): number | null {
  const vals = rows
    .map(pick)
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  return avg(vals);
}

export type WindowStats = {
  count: number;
  merge_rate_pct: number | null;
  prs_merged: number | null;
  prs_rejected: number | null;
  median_pr_size_lines: number | null;
  proposal_approval_rate_pct: number | null;
};

export type BeforeAfter = {
  before: WindowStats;
  after: WindowStats;
  thin: boolean; // fewer than 5 snapshots on either side
  cutoff: string;
};

function windowStats(rows: MetricSnapshot[]): WindowStats {
  return {
    count: rows.length,
    merge_rate_pct: collect(rows, (s) => s.merge_rate_pct),
    prs_merged: collect(rows, (s) => s.prs_merged),
    prs_rejected: collect(rows, (s) => s.prs_rejected),
    median_pr_size_lines: collect(rows, (s) => s.median_pr_size_lines),
    proposal_approval_rate_pct: collect(rows, (s) => s.proposal_approval_rate_pct),
  };
}

/**
 * Split snapshots around an ISO cutoff date. Snapshots strictly before the
 * commit date form the "before" window; the commit date and later form "after".
 */
export function splitMetrics(
  snapshots: MetricSnapshot[],
  cutoffIso: string,
): BeforeAfter {
  const cutoff = new Date(cutoffIso).getTime();
  const before: MetricSnapshot[] = [];
  const after: MetricSnapshot[] = [];
  for (const s of snapshots) {
    const t = new Date(s.date).getTime();
    if (Number.isNaN(t)) continue;
    if (t < cutoff) before.push(s);
    else after.push(s);
  }
  const b = windowStats(before);
  const a = windowStats(after);
  return {
    before: b,
    after: a,
    thin: b.count < 5 || a.count < 5,
    cutoff: cutoffIso,
  };
}

export function parseMetrics(raw: string | null): MetricSnapshot[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data as MetricSnapshot[];
    if (Array.isArray((data as { history?: unknown }).history))
      return (data as { history: MetricSnapshot[] }).history;
    return [];
  } catch {
    return [];
  }
}
