/**
 * Single source of truth for the primary navigation. The app shell renders
 * these both as a desktop sidebar and a mobile bottom tab bar. Feature agents
 * adding a top-level section should add an entry here (and a matching page
 * under app/(app)/<slug>/page.tsx).
 */

import {
  Workflow,
  Lightbulb,
  Hammer,
  FlaskConical,
  Wrench,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/map", label: "Process Map", icon: Workflow },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/builds", label: "Builds & Evidence", icon: Hammer },
  { href: "/testing", label: "Testing", icon: FlaskConical },
  { href: "/tools", label: "Tools", icon: Wrench },
  { href: "/metrics", label: "Metrics", icon: BarChart3 },
];
