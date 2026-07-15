/**
 * Project registry + per-project agent manifests.
 *
 * The registry lives as config/projects.json IN THE DASHBOARD REPO, read and
 * written through the GitHub API — so it behaves identically wherever the
 * dashboard runs. Reads are cached in-process for 60 seconds.
 *
 * A project's "agent manifest" is built from its .github/workflows/ listing:
 * baseline files render as the known agents; any other claude-*.yml appears
 * as a generic agent (name from its YAML `name:` field) with the full drawer.
 */

import { getOctokit, getFileContent, commitFile, type RepoConfig } from "./github";
import { AGENTS } from "./map-agents";
import type { AgentMeta } from "./map-types";

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const DASHBOARD_REPO: RepoConfig = { owner: "ApagPlayz", repo: "loop-dashboard" };
export const REGISTRY_PATH = "config/projects.json";

export type Project = {
  key: string;
  owner: string;
  repo: string;
  label: string;
  addedAt: string;
};

/** The pilot — also the fallback if the registry file can't be read. */
export const PILOT_PROJECT: Project = {
  key: "content-generation-platform",
  owner: "ApagPlayz",
  repo: "content-generation-platform",
  label: "Content Generation Platform",
  addedAt: "2026-07-15T00:00:00Z",
};

export class ProjectError extends Error {
  constructor(
    message: string,
    public httpStatus: number = 404,
  ) {
    super(message);
  }
}

const REGISTRY_TTL_MS = 60_000;
let registryCache: { at: number; projects: Project[] } | null = null;

function parseRegistry(raw: string | null): Project[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { projects?: Project[] };
    if (!Array.isArray(parsed.projects)) return null;
    return parsed.projects.filter(
      (p) => p && typeof p.key === "string" && typeof p.owner === "string" && typeof p.repo === "string",
    );
  } catch {
    return null;
  }
}

/** All registered projects (cached ~60s). Falls back to the pilot alone. */
export async function listProjects(force = false): Promise<Project[]> {
  if (!force && registryCache && Date.now() - registryCache.at < REGISTRY_TTL_MS) {
    return registryCache.projects;
  }
  let projects: Project[] | null = null;
  try {
    const raw = await getFileContent(REGISTRY_PATH, undefined, DASHBOARD_REPO);
    projects = parseRegistry(raw);
  } catch (err) {
    console.error("projects: registry read failed", err);
  }
  const result = projects && projects.length > 0 ? projects : [PILOT_PROJECT];
  registryCache = { at: Date.now(), projects: result };
  return result;
}

/** Register a new project (commits config/projects.json to the dashboard repo). */
export async function addProject(project: Omit<Project, "addedAt">): Promise<Project> {
  const existing = await listProjects(true);
  if (existing.some((p) => p.key === project.key)) {
    throw new ProjectError("That project is already on the dashboard.", 409);
  }
  const full: Project = { ...project, addedAt: new Date().toISOString() };
  const next = [...existing, full];
  await commitFile(
    REGISTRY_PATH,
    JSON.stringify({ projects: next }, null, 2) + "\n",
    `dashboard: add project ${project.key}`,
    { repo: DASHBOARD_REPO },
  );
  registryCache = { at: Date.now(), projects: next };
  return full;
}

/** Resolve a registry key (or default: the pilot) to a project + RepoConfig. */
export async function resolveProject(
  key?: string | null,
): Promise<{ project: Project; repo: RepoConfig }> {
  const projects = await listProjects();
  const wanted = key || PILOT_PROJECT.key;
  const project = projects.find((p) => p.key === wanted);
  if (!project) throw new ProjectError("Unknown project.");
  return { project, repo: { owner: project.owner, repo: project.repo } };
}

/** Convenience: resolve the ?project= query param of a route request. */
export async function resolveProjectFromUrl(
  reqUrl: string,
): Promise<{ project: Project; repo: RepoConfig }> {
  return resolveProject(new URL(reqUrl).searchParams.get("project"));
}

/* ------------------------------------------------------------------ */
/* Per-project agent manifest                                          */
/* ------------------------------------------------------------------ */

const MANIFEST_TTL_MS = 60_000;
const manifestCache = new Map<string, { at: number; agents: AgentMeta[] }>();

const BASELINE_FILES = new Set(AGENTS.map((a) => a.file));

/** Plain-English trigger list guessed from a workflow's YAML. */
function parseGenericTriggers(yaml: string): string[] {
  const out: string[] = [];
  if (/^\s*schedule:/m.test(yaml)) out.push("On a schedule");
  if (/^\s*workflow_dispatch:?\s*$/m.test(yaml) || /workflow_dispatch:/.test(yaml))
    out.push("Can be run on demand");
  if (/^\s*pull_request(_review_comment|_target)?:/m.test(yaml)) out.push("On pull requests");
  if (/^\s*issues:/m.test(yaml)) out.push("When issues change");
  if (/^\s*issue_comment:/m.test(yaml)) out.push("When someone comments");
  if (/^\s*repository_dispatch:/m.test(yaml)) out.push("Triggered by an outside signal");
  if (/^\s*push:/m.test(yaml)) out.push("When code is pushed");
  return out.length ? out : ["See the workflow file for its triggers"];
}

/** Manual runs are only offered when dispatch needs no inputs we can't know. */
function parseGenericDispatch(yaml: string): boolean {
  if (!/workflow_dispatch/.test(yaml)) return false;
  return !/workflow_dispatch:\s*\n\s+inputs:/.test(yaml);
}

function genericMeta(file: string, yaml: string | null): AgentMeta {
  const nameMatch = yaml?.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  const label = nameMatch ? nameMatch[1] : file.replace(/\.ya?ml$/, "");
  return {
    id: file.replace(/\.ya?ml$/, ""),
    label,
    file,
    tagline: "Custom agent for this project",
    description:
      "A custom agent that exists only in this project (it isn't part of the standard loop). You can read and edit its instructions, see its runs, and check its history — same as any other agent.",
    triggers: yaml ? parseGenericTriggers(yaml) : ["See the workflow file for its triggers"],
    onMain: true,
    canDispatch: yaml ? parseGenericDispatch(yaml) : false,
    dispatch: "none",
    generic: true,
  };
}

/**
 * The agents of one project: baseline agents whose workflow file exists in
 * the repo, plus a generic agent for every other claude-*.yml. Cached ~60s.
 */
export async function getProjectAgents(project: Project): Promise<AgentMeta[]> {
  const cached = manifestCache.get(project.key);
  if (cached && Date.now() - cached.at < MANIFEST_TTL_MS) return cached.agents;

  const repo: RepoConfig = { owner: project.owner, repo: project.repo };
  let files: string[] = [];
  try {
    const res = await getOctokit().rest.repos.getContent({
      owner: repo.owner,
      repo: repo.repo,
      path: ".github/workflows",
    });
    if (Array.isArray(res.data)) {
      files = res.data.filter((e) => e.type === "file").map((e) => e.name);
    }
  } catch (err: unknown) {
    if ((err as { status?: number })?.status !== 404) {
      console.error(`projects: workflow listing failed for ${project.key}`, err);
      // On a transient error, fall back to the baseline so the map still renders.
      return AGENTS;
    }
    // 404: repo simply has no workflows yet.
  }

  const present = new Set(files);
  const baseline = AGENTS.filter((a) => present.has(a.file));

  const extraFiles = files.filter((f) => /^claude-.*\.ya?ml$/.test(f) && !BASELINE_FILES.has(f));
  const extras = await Promise.all(
    extraFiles.map(async (file) => {
      const yaml = await getFileContent(`.github/workflows/${file}`, undefined, repo).catch(
        () => null,
      );
      return genericMeta(file, yaml);
    }),
  );

  const agents = [...baseline, ...extras];
  manifestCache.set(project.key, { at: Date.now(), agents });
  return agents;
}

/** Look one agent up in a project's manifest (baseline or generic). */
export async function findProjectAgent(
  project: Project,
  id: string,
): Promise<AgentMeta | undefined> {
  const agents = await getProjectAgents(project);
  return agents.find((a) => a.id === id);
}
