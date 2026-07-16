"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, FolderGit2, Loader2 } from "lucide-react";
import type { Project } from "@/lib/projects";
import EditMenu from "./edit-menu";
import ProcessChatEditor from "./process-chat-editor";

/** The /map/edit/[project] screen: chat editor for one project's live loop. */
export default function ProjectEditScreen({ projectKey }: { projectKey: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/map/projects");
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? "Couldn't load the project list.");
        if (cancelled) return;
        const found = (j.projects as Project[]).find((p) => p.key === projectKey) ?? null;
        setProject(found);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load the project list.");
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

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

      {!loaded && (
        <p className="flex items-center gap-2 py-4 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the project…
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {loaded && !error && project === null && (
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
