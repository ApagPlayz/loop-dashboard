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

/**
 * The pilot — the first project the loop ever ran on.
 *
 * It is NOT a fallback. Nothing here silently substitutes it for a project
 * that wasn't named or a registry that wouldn't load: doing that quietly
 * pointed writes at the pilot's repo from the wrong screen. It survives as a
 * seed value for the one place a hard default is genuinely needed (the app
 * shell's initial selection when the registry is unreadable).
 */
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

/**
 * All registered projects (cached ~60s).
 *
 * A failed or unparseable read is an ERROR, not "the pilot" — collapsing to a
 * one-project list made a GitHub outage look like the owner had deleted every
 * other project, and pointed the whole UI at the pilot's repo. If we still
 * hold a previously-read list we serve that (stale beats wrong); otherwise we
 * throw and the caller surfaces it.
 */
export async function listProjects(force = false): Promise<Project[]> {
  if (!force && registryCache && Date.now() - registryCache.at < REGISTRY_TTL_MS) {
    return registryCache.projects;
  }
  let projects: Project[] | null = null;
  let readError: unknown = null;
  try {
    const raw = await getFileContent(REGISTRY_PATH, undefined, DASHBOARD_REPO);
    projects = parseRegistry(raw);
    if (projects === null) readError = new Error(`${REGISTRY_PATH} is missing or malformed`);
  } catch (err) {
    readError = err;
  }

  if (projects === null) {
    console.error("projects: registry read failed", readError);
    if (registryCache) return registryCache.projects; // stale, but real
    throw new ProjectError(
      "Couldn't read the project list from GitHub. Refresh in a moment.",
      502,
    );
  }

  registryCache = { at: Date.now(), projects };
  return projects;
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

/**
 * Resolve a registry key to a project + RepoConfig.
 *
 * A MISSING key is a caller bug, not a request for the pilot: this used to
 * default to the pilot, so any screen that forgot to pass its project silently
 * read — and wrote to — the pilot's repo. It now throws `ProjectError` with
 * status 400 (missing) or 404 (unknown), which every route already maps onto
 * its error JSON. UI code that legitimately has no selection yet should use
 * {@link defaultProjectKey} instead.
 */
export async function resolveProject(
  key?: string | null,
): Promise<{ project: Project; repo: RepoConfig }> {
  const wanted = (key ?? "").trim();
  if (!wanted) {
    throw new ProjectError("No project was specified for this request.", 400);
  }
  const projects = await listProjects();
  const project = projects.find((p) => p.key === wanted);
  if (!project) throw new ProjectError("Unknown project.", 404);
  return { project, repo: { owner: project.owner, repo: project.repo } };
}

/** Convenience: resolve the ?project= query param of a route request. */
export async function resolveProjectFromUrl(
  reqUrl: string,
): Promise<{ project: Project; repo: RepoConfig }> {
  return resolveProject(new URL(reqUrl).searchParams.get("project"));
}

/**
 * The project to show when nothing has been chosen yet — the owner's saved
 * selection if it still exists, else the FIRST registered project (not the
 * pilot). For server-rendered screens that read the selection cookie; API
 * routes should require an explicit project instead.
 */
export async function defaultProjectKey(preferred?: string | null): Promise<string> {
  let projects: Project[];
  try {
    projects = await listProjects();
  } catch {
    return preferred?.trim() || PILOT_PROJECT.key;
  }
  const wanted = (preferred ?? "").trim();
  return (
    projects.find((p) => p.key === wanted)?.key ?? projects[0]?.key ?? PILOT_PROJECT.key
  );
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
