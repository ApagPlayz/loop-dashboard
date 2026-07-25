"use client";

/**
 * Global "current project" context — the backbone of the project-scoped
 * dashboard. One switcher in the app shell drives every scoped section.
 *
 * The selected project key is mirrored into a cookie (PROJECT_COOKIE) so that
 * server components (e.g. Metrics) and API routes that default to the cookie
 * can read the same selection the client sees. Changing project writes the
 * cookie and calls router.refresh() so any server-rendered scoped content
 * re-reads it; client components read `useProject()` and refetch on change.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/projects";

export const PROJECT_COOKIE = "loop_project";

type ProjectCtx = {
  /** Selected project key. */
  project: string;
  /** The resolved Project record for `project`, or null if not yet known. */
  current: Project | null;
  /** All registered projects. */
  projects: Project[];
  /** Switch the active project (persists + refreshes scoped views). */
  setProject: (key: string) => void;
  /** Re-pull the registry (after adding a project). */
  refreshProjects: () => Promise<void>;
};

const Ctx = createContext<ProjectCtx | null>(null);

export function ProjectProvider({
  initialProject,
  initialProjects,
  children,
}: {
  initialProject: string;
  initialProjects: Project[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [project, setProjectKey] = useState<string>(initialProject);
  const [, startTransition] = useTransition();

  const setProject = useCallback(
    (key: string) => {
      if (!key) return;
      setProjectKey(key);
      // Persist for the server side (scoped server components + API defaults).
      document.cookie = `${PROJECT_COOKIE}=${encodeURIComponent(
        key,
      )}; path=/; max-age=31536000; samesite=lax`;
      // Re-run server components on the current route so scoped server-rendered
      // pages (e.g. Metrics) pick up the new selection.
      startTransition(() => router.refresh());
    },
    [router],
  );

  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/map/projects");
      const j = (await res.json().catch(() => ({}))) as { projects?: Project[] };
      if (res.ok && Array.isArray(j.projects)) setProjects(j.projects);
    } catch {
      /* keep whatever we have */
    }
  }, []);

  const current = useMemo(
    () => projects.find((p) => p.key === project) ?? null,
    [projects, project],
  );

  const value = useMemo<ProjectCtx>(
    () => ({ project, current, projects, setProject, refreshProjects }),
    [project, current, projects, setProject, refreshProjects],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Read the current project scope. Must be used within <ProjectProvider>. */
export function useProject(): ProjectCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject must be used within a ProjectProvider");
  return v;
}
