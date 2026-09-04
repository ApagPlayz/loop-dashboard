"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, FolderGit2 } from "lucide-react";
import EditMenu from "./edit-menu";
import ProcessChatEditor from "./process-chat-editor";
import { useProject } from "@/components/project-context";

/**
 * The /map/edit/[project] screen: chat editor for one project's live loop.
 *
 * The registry comes from the shared project context (server-rendered into the
 * page) rather than a fetch of this screen's own, so the project named in the
 * URL resolves on the first paint with no loading state at all.
 */
export default function ProjectEditScreen({ projectKey }: { projectKey: string }) {
  const { projects } = useProject();
  const project = projects.find((p) => p.key === projectKey) ?? null;

  return (
    <div className="space-y-4">
      {/* Toolbar: same Edit menu as the map + a way back */}
      <div className="flex flex-wrap items-center gap-2">
        <EditMenu active={projectKey} />
        <Link
          href={`/map?project=${encodeURIComponent(projectKey)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the map
        </Link>
        {project && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-400">
            <FolderGit2 className="h-3 w-3 text-emerald-400" /> {project.owner}/{project.repo}
          </span>
        )}
      </div>

      {project === null && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            That project isn&apos;t on the dashboard. Pick one from the Edit menu above, or go{" "}
            <Link href="/map" className="underline">
              back to the map
            </Link>
            .
          </span>
        </div>
      )}

      {project && (
        <>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
            You&apos;re editing the live loop of{" "}
            <strong className="text-zinc-300">{project.label}</strong>. Changes you apply here go
            straight onto that project&apos;s agents — you&apos;ll see exactly what would change
            before anything is saved.
          </p>
          <ProcessChatEditor
            target={project.key}
            greeting={`Hi! Tell me what you'd like to change about how ${project.label}'s agents work — for example when they run, what they focus on, or how they behave. I'll draft the change and show you exactly what it does before anything is saved.`}
          />
        </>
      )}
    </div>
  );
}
