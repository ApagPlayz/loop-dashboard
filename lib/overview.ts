/**
 * Data for the Overview landing page ("/").
 *
 * Nothing here is new loop logic — it re-uses the same primitives the rest of
 * the dashboard already reads from:
 *   - lib/projects.ts  listProjects() / getProjectAgents()
 *   - lib/github.ts    listIssues() / listPRs()
 * and applies the same conventions the scoped pages use, so the numbers on
 * "/" agree with the ones on /ideas, /builds and /map:
 *   - an "idea" is an open issue carrying one of the queue labels
 *     (proposal / approved / redraft) — see lib/queues.ts loadIdeas()
 *   - an "open PR" is an open pull request from a claude/** branch —
 *     see lib/queues.ts loadBuilds() and app/api/map/status
 */

import { listIssues, listPRs, type RepoConfig } from "@/lib/github";
import { getProjectAgents, type Project } from "@/lib/projects";

/** The queue labels that make an issue an "idea" (mirrors lib/queues.ts). */
const IDEA_LABELS = ["proposal", "approved", "redraft"];

/** Days without any issue/PR update before a set-up project reads as idle. */
const ACTIVE_WINDOW_DAYS = 7;

export type ProjectStatus = "building" | "active" | "idle" | "needs-setup";

export type ProjectSnapshot = {
  key: string;
  label: string;
  owner: string;
  repo: string;
  /** Open issues carrying a queue label. */
  openIdeas: number;
  /** Subset of openIdeas that are approved and waiting to be built. */
  approved: number;
  /** Open pull requests from claude/** branches. */
  openPRs: number;
  /** Loop workflows detected in .github/workflows (0 ⇒ not set up yet). */
  agents: number;
  status: ProjectStatus;
  /** Most recent issue/PR update, ISO — null when there's nothing to date. */
  lastActivity: string | null;
  /** True when GitHub couldn't be read for this project. */
  unreachable: boolean;
};

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : (l as { name?: string })?.name))
    .filter((n): n is string => typeof n === "string");
}

function newest(dates: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || +new Date(d) > +new Date(best)) best = d;
  }
  return best;
}

function classify(
  agents: number,
  openPRs: number,
  lastActivity: string | null,
): ProjectStatus {
  if (agents === 0) return "needs-setup";
  if (openPRs > 0) return "building";
  if (
    lastActivity &&
    Date.now() - +new Date(lastActivity) < ACTIVE_WINDOW_DAYS * 86_400_000
  ) {
    return "active";
  }
  return "idle";
}

/** One project's headline numbers. Never throws — degrades to zeros. */
export async function loadProjectSnapshot(
  project: Project,
): Promise<ProjectSnapshot> {
  const repo: RepoConfig = { owner: project.owner, repo: project.repo };
  const base = {
    key: project.key,
    label: project.label,
    owner: project.owner,
    repo: project.repo,
  };

  try {
    const [issues, prs, agents] = await Promise.all([
      listIssues(undefined, { state: "open", repo }),
      listPRs({ state: "open", repo }),
      getProjectAgents(project).catch(() => []),
    ]);

    const ideas = issues.filter((i) =>
      labelNames(i.labels).some((l) => IDEA_LABELS.includes(l)),
    );
    const approved = ideas.filter((i) => {
      const names = labelNames(i.labels);
      return names.includes("approved") && !names.includes("proposal");
    });
    const openPRs = prs.filter((p) => (p.head?.ref ?? "").startsWith("claude/"));

    const lastActivity = newest([
      ...issues.map((i) => i.updated_at),
      ...prs.map((p) => p.updated_at),
    ]);

    return {
      ...base,
      openIdeas: ideas.length,
      approved: approved.length,
      openPRs: openPRs.length,
      agents: agents.length,
      status: classify(agents.length, openPRs.length, lastActivity),
      lastActivity,
      unreachable: false,
    };
  } catch (err) {
    console.error(`overview: snapshot failed for ${project.key}`, err);
    return {
      ...base,
      openIdeas: 0,
      approved: 0,
      openPRs: 0,
      agents: 0,
      status: "idle",
      lastActivity: null,
      unreachable: true,
    };
  }
}

/** Snapshots for every registered project, loaded in parallel. */
export async function loadOverview(
  projects: Project[],
): Promise<ProjectSnapshot[]> {
  return Promise.all(projects.map(loadProjectSnapshot));
}
