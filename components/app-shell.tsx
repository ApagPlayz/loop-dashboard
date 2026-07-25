"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, PROJECT_NAV, GLOBAL_NAV, type NavItem } from "@/lib/nav";
import { useProject } from "@/components/project-context";
import ProjectSwitcher from "@/components/map/project-switcher";

/**
 * App shell: a fixed left sidebar on desktop, a fixed bottom tab bar on mobile.
 * The global project switcher sits at the top of the sidebar; the nav is split
 * into a "This project" group (scoped) and a "Global" group (shared). Active
 * section is derived from the current pathname.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { project, setProject, refreshProjects } = useProject();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function onSelect(key: string) {
    setProject(key);
    // Keep the registry fresh (e.g. right after adding a new project).
    void refreshProjects();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-zinc-800 bg-zinc-900 md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-zinc-800 px-5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-sm font-semibold tracking-tight text-zinc-100">
            Loop Dashboard
          </span>
        </div>

        <div className="border-b border-zinc-800 p-3">
          <ProjectSwitcher selected={project} onSelect={onSelect} />
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          <NavGroup label="This project" dot="bg-emerald-500" items={PROJECT_NAV} isActive={isActive} />
          <NavGroup label="Global" dot="bg-violet-400" items={GLOBAL_NAV} isActive={isActive} />
        </nav>

        <div className="border-t border-zinc-800 p-3">
          <LogoutButton />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/95 px-4 backdrop-blur md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
          <ProjectSwitcher selected={project} onSelect={onSelect} />
        </div>
        <LogoutButton compact />
      </header>

      {/* Content */}
      <main className="md:pl-60">
        <div className="mx-auto max-w-5xl px-4 pb-24 pt-6 md:px-8 md:pb-10">
          {children}
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-800 bg-zinc-900/95 backdrop-blur md:hidden">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition ${
              isActive(href)
                ? "text-emerald-400"
                : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="truncate px-0.5">{shortLabel(label)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function NavGroup({
  label,
  dot,
  items,
  isActive,
}: {
  label: string;
  dot: string;
  items: NavItem[];
  isActive: (href: string) => boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </p>
      {items.map(({ href, label: itemLabel, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
            isActive(href)
              ? "bg-emerald-500/10 text-emerald-400"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {itemLabel}
        </Link>
      ))}
    </div>
  );
}

function shortLabel(label: string) {
  // Bottom tab bar is tight — use the first word.
  return label.split(" ")[0];
}

function LogoutButton({ compact = false }: { compact?: boolean }) {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={logout}
      className={`text-zinc-400 transition hover:text-zinc-100 ${
        compact
          ? "shrink-0 text-xs"
          : "w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-800"
      }`}
    >
      Sign out
    </button>
  );
}
