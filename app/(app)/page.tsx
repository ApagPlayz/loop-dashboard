import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowUpRight } from "lucide-react";
import { PROJECT_COOKIE } from "@/components/project-context";
import ProjectCards, { StatusPill } from "@/components/overview/project-cards";
import { GLOBAL_NAV } from "@/lib/nav";
import { listProjects, PILOT_PROJECT, type Project } from "@/lib/projects";
import { loadOverview, type ProjectSnapshot } from "@/lib/overview";
import { isPublicViewer } from "@/lib/demo/viewer";
import { DEMO_OVERVIEW } from "@/lib/demo/fixtures-pages";

// Live counts straight from GitHub on every request.
export const dynamic = "force-dynamic";

/**
 * Overview — the dashboard's landing page ("/").
 *
 * Two reads of the same loop: the KPI row is the *selected* project (resolved
 * from the same cookie app/(app)/layout.tsx uses), the card grid is *every*
 * registered project, and clicking a card switches the global scope.
 *
 * This page is built entirely on the new navy/Inter design tokens declared in
 * app/globals.css — the rest of the app still renders the older zinc surfaces
 * until the Phase 2 migration.
 */
export default async function OverviewPage() {
  let projects: Project[];
  try {
    projects = await listProjects();
  } catch {
    projects = [PILOT_PROJECT];
  }

  const cookieStore = await cookies();
  const cookieKey = cookieStore.get(PROJECT_COOKIE)?.value;
  const currentKey =
    projects.find((p) => p.key === cookieKey)?.key ??
    projects[0]?.key ??
    PILOT_PROJECT.key;

  // Demo: loadOverview() calls listIssues()/listPRs() straight against GitHub,
  // which 404s for the fictional loop-demo/* repos (and isn't proxied — only
  // /api/* requests are). Show the frozen snapshot instead so the landing page
  // looks like a live project rather than two "unreachable" cards.
  const snapshots = (await isPublicViewer())
    ? DEMO_OVERVIEW
    : await loadOverview(projects);
  const current =
    snapshots.find((s) => s.key === currentKey) ?? snapshots[0] ?? null;

  // The wrapper bleeds over the shell's content padding so the new navy
  // background covers the whole page area instead of floating on zinc-950.
  return (
    <div className="-mx-4 -mb-24 -mt-6 min-h-[calc(100vh-1.5rem)] bg-ds-bg px-4 pb-24 pt-6 text-ds-text md:-mx-8 md:-mb-10 md:px-8 md:pb-10">
      <header className="mb-6">
        <p className="text-[10px] font-medium uppercase tracking-ds-eyebrow text-ds-faint">
          Overview
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-ds-tight text-ds-text">
            {current?.label ?? "Loop Dashboard"}
          </h1>
          {current && (
            <StatusPill
              status={current.status}
              unreachable={current.unreachable}
            />
          )}
        </div>
        <p className="mt-1.5 text-sm text-ds-muted">
          {current
            ? `Where the loop stands for this project right now — last activity ${since(
                current.lastActivity,
              )}.`
            : "Where the loop stands right now."}
        </p>
      </header>

      {/* KPI row — the selected project */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi
          label="Open ideas"
          value={current?.openIdeas ?? 0}
          hint="Proposals, approved and redraft"
          href="/ideas"
        />
        <Kpi
          label="Approved & waiting"
          value={current?.approved ?? 0}
          hint="Signed off, not yet built"
          href="/ideas"
          accent={(current?.approved ?? 0) > 0}
        />
        <Kpi
          label="Open PRs"
          value={current?.openPRs ?? 0}
          hint="Builder branches awaiting review"
          href="/builds"
          accent={(current?.openPRs ?? 0) > 0}
        />
      </div>

      {current?.unreachable && (
        <p className="mt-3 rounded-lg border border-ds-danger/30 bg-ds-danger/10 px-3 py-2 text-xs text-ds-danger">
          GitHub couldn&apos;t be reached for this project, so these counts are
          not live.
        </p>
      )}

      {/* Every registered project */}
      <Section title="Projects" hint={countLabel(snapshots)}>
        <ProjectCards snapshots={snapshots} />
      </Section>

      {/* Global sections — same for every project */}
      <Section title="Global" hint="Shared across all projects">
        <div className="grid gap-3 sm:grid-cols-2">
          {GLOBAL_NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-3 rounded-xl border border-ds-border bg-ds-panel p-4 transition hover:border-ds-accent/25 hover:bg-ds-panel-2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ds-border bg-ds-panel-2 text-ds-muted transition group-hover:text-ds-accent">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-ds-heading text-ds-text">
                {label}
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-ds-faint transition group-hover:text-ds-accent" />
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[10px] font-medium uppercase tracking-ds-eyebrow text-ds-faint">
          {title}
        </h2>
        {hint && <p className="text-[11px] text-ds-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  href,
  accent = false,
}: {
  label: string;
  value: number;
  hint: string;
  href: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-ds-border bg-ds-panel p-4 transition hover:border-ds-accent/25 hover:bg-ds-panel-2"
    >
      <p className="text-[10px] font-medium uppercase tracking-ds-eyebrow text-ds-faint">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums tracking-ds-tight ${
          accent ? "text-ds-accent" : "text-ds-text"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-ds-muted">{hint}</p>
    </Link>
  );
}

function countLabel(snapshots: ProjectSnapshot[]): string {
  const n = snapshots.length;
  const setup = snapshots.filter((s) => s.status !== "needs-setup").length;
  return `${n} registered · ${setup} set up`;
}

/** Compact "3 days ago" for a server-rendered timestamp. */
function since(iso: string | null): string {
  if (!iso) return "unknown";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(secs)) return "unknown";
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}
