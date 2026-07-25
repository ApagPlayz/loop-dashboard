/**
 * Single source of truth for the primary navigation. The app shell renders
 * these grouped by scope: a "This project" group (everything that follows the
 * global project switcher) and a "Global" group (shared across all projects).
 * Feature agents adding a top-level section should add an entry here (and a
 * matching page under app/(app)/<slug>/page.tsx) with the correct `scope`.
 */

import {
  Workflow,
  Lightbulb,
  GitPullRequest,
  BookText,
  FlaskConical,
  BarChart3,
  Blocks,
  Newspaper,
  type LucideIcon,
} from "lucide-react";

/** "project" = scoped to the selected project; "global" = shared across all. */
export type NavScope = "project" | "global";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  scope: NavScope;
};

export const NAV_ITEMS: NavItem[] = [
  // This project — follows the global project switcher.
  { href: "/map", label: "Process Map", icon: Workflow, scope: "project" },
  { href: "/ideas", label: "Ideas", icon: Lightbulb, scope: "project" },
  { href: "/builds", label: "Pull Requests", icon: GitPullRequest, scope: "project" },
  { href: "/learnings", label: "Learnings", icon: BookText, scope: "project" },
  { href: "/testing", label: "Testing", icon: FlaskConical, scope: "project" },
  { href: "/metrics", label: "Metrics", icon: BarChart3, scope: "project" },
  // Global — the same for every project.
  { href: "/tools", label: "Tool Catalog", icon: Blocks, scope: "global" },
  { href: "/reporter", label: "News", icon: Newspaper, scope: "global" },
];

export const PROJECT_NAV = NAV_ITEMS.filter((n) => n.scope === "project");
export const GLOBAL_NAV = NAV_ITEMS.filter((n) => n.scope === "global");
