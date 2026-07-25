import { cookies } from "next/headers";
import AppShell from "@/components/app-shell";
import { ProjectProvider, PROJECT_COOKIE } from "@/components/project-context";
import { listProjects, PILOT_PROJECT, type Project } from "@/lib/projects";

// Everything under this route group renders inside the authenticated app shell.
// The /login page lives outside the group, so it stays chrome-free.
//
// We resolve the current project scope here (server-side) so the shell and its
// switcher render with the right selection immediately — no client flash — and
// so scoped server components can read the same cookie.
export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let projects: Project[];
  try {
    projects = await listProjects();
  } catch {
    projects = [PILOT_PROJECT];
  }

  const cookieStore = await cookies();
  const cookieKey = cookieStore.get(PROJECT_COOKIE)?.value;
  const initialProject =
    projects.find((p) => p.key === cookieKey)?.key ??
    projects[0]?.key ??
    PILOT_PROJECT.key;

  return (
    <ProjectProvider initialProject={initialProject} initialProjects={projects}>
      <AppShell>{children}</AppShell>
    </ProjectProvider>
  );
}
