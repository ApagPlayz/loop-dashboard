"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  FolderGit2,
  LayoutTemplate,
  PenLine,
  Workflow,
} from "lucide-react";
import { useProject } from "@/components/project-context";
import { useEscapeKey } from "./use-escape";

/**
 * The "Edit" dropdown — one menu for every way to change how processes work:
 *   1. The process map itself (the default editor).
 *   2. The new-project template, edited by chatting with AI.
 *   3. Any registered project's live workflows, edited by chatting with AI.
 *
 * Mounted in the map toolbar and on both editor pages so navigation between
 * the three is symmetric. `active` marks where the owner currently is:
 * "map", "template", or a project key.
 *
 * The project list comes from the shared project context — the server already
 * rendered it into the page, so this menu costs no request of its own.
 */
export default function EditMenu({ active }: { active: "map" | "template" | string }) {
  const { projects } = useProject();
  const [open, setOpen] = useState(false);

  // Escape closes the menu, matching the outside-click that already does.
  useEscapeKey(() => setOpen(false), open);

  const itemClass = (isActive: boolean) =>
    `flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
      isActive ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-300 hover:bg-zinc-800"
    }`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
      >
        <PenLine className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        Edit
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-zinc-800 bg-zinc-950 p-1.5 shadow-2xl">
            <Link href="/map" onClick={() => setOpen(false)} className={itemClass(active === "map")}>
              <Workflow className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">Process map</span>
                <span className="block truncate text-[10px] text-zinc-500">
                  The default editor — tap agents on the map
                </span>
              </span>
              {active === "map" && <Check className="h-3.5 w-3.5 shrink-0" />}
            </Link>

            <Link
              href="/map/template"
              onClick={() => setOpen(false)}
              className={itemClass(active === "template")}
            >
              <LayoutTemplate className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">New-project template</span>
                <span className="block truncate text-[10px] text-zinc-500">
                  Edit with AI what new projects get
                </span>
              </span>
              {active === "template" && <Check className="h-3.5 w-3.5 shrink-0" />}
            </Link>

            <div className="my-1 border-t border-zinc-800" />
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Edit a project with AI
            </p>
            {projects.length === 0 ? (
              <p className="px-2.5 pb-2 text-xs text-zinc-500">No projects yet.</p>
            ) : (
              projects.map((p) => (
                <Link
                  key={p.key}
                  href={`/map/edit/${encodeURIComponent(p.key)}`}
                  onClick={() => setOpen(false)}
                  className={itemClass(active === p.key)}
                >
                  <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.label}</span>
                    <span className="block truncate font-mono text-[10px] text-zinc-500">
                      {p.owner}/{p.repo}
                    </span>
                  </span>
                  {active === p.key && <Check className="h-3.5 w-3.5 shrink-0" />}
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
