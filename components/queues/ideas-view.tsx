"use client";

import { useCallback, useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import type { IdeasPayload, IdeaSummary } from "@/lib/queues";
import type { Project } from "@/lib/projects";
import ProjectSwitcher from "@/components/map/project-switcher";
import { TabBar, ErrorPanel, EmptyState, Spinner } from "./ui";
import { ToastProvider } from "./toast";
import IdeaCard from "./idea-card";
import CustomIdea from "./custom-idea";
import AutomationPanel from "./automation-panel";

const PILOT_KEY = "content-generation-platform";
// Deliberately its own key, separate from the Map page's — a shared/global
// project switcher across pages is a later follow-up, not this round.
const PROJECT_LS_KEY = "loop-dashboard.project.ideas";

type TabKey = "waiting" | "approved" | "redraft" | "closed";

const TAB_LABELS: Record<TabKey, string> = {
  waiting: "Waiting for you",
  approved: "Approved",
  redraft: "Being redrafted",
  closed: "Recently closed",
};

const EMPTY_COPY: Record<TabKey, string> = {
  waiting: "Nothing waiting on you. The Scout will file new ideas here.",
  approved: "No approved ideas queued. Approve one and it lands here.",
  redraft: "Nothing being redrafted right now.",
  closed: "No recently closed ideas.",
};

export default function IdeasView() {
  return (
    <ToastProvider>
      <IdeasInner />
    </ToastProvider>
  );
}

function IdeasInner() {
  const [data, setData] = useState<IdeasPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("waiting");
  const [showCustom, setShowCustom] = useState(false);
  const [project, setProject] = useState(PILOT_KEY);
  const [projects, setProjects] = useState<Project[]>([]);

  // Restore the selected project from the URL (?project=) or localStorage —
  // same pattern the Map page uses, but with its own storage key.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("project");
    const saved = fromUrl || window.localStorage.getItem(PROJECT_LS_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved && saved !== PILOT_KEY) setProject(saved);
  }, []);

  // Project labels for the "Viewing: <project>" indicator.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/map/projects");
        const j = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(j.projects)) setProjects(j.projects);
      } catch {
        /* label just falls back to the raw key */
      }
    })();
  }, []);

  const selectProject = useCallback((key: string) => {
    setProject(key);
    setData(null);
    setError(null);
    try {
      window.localStorage.setItem(PROJECT_LS_KEY, key);
      const url = new URL(window.location.href);
      url.searchParams.set("project", key);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* cosmetic only */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ideas?project=${encodeURIComponent(project)}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to load ideas");
      setData(payload as IdeasPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ideas");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    // Defer so we don't call setState synchronously inside the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const projectLabel = projects.find((p) => p.key === project)?.label ?? project;

  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ProjectSwitcher selected={project} onSelect={selectProject} />
        <span className="text-xs text-zinc-500">
          Viewing: <span className="text-zinc-300">{projectLabel}</span>
        </span>
      </div>
      <button
        onClick={() => setShowCustom(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
      >
        <PenLine className="h-4 w-4" />
        Custom idea
      </button>
      {showCustom && (
        <CustomIdea
          onClose={() => setShowCustom(false)}
          onRefreshPilot={load}
          project={project}
        />
      )}
    </div>
  );

  const automationPanel = (
    <AutomationPanel
      project={project}
      projectLabel={projectLabel}
      waitingCount={data?.waiting?.length ?? 0}
    />
  );

  if (loading && !data) {
    return (
      <div>
        {toolbar}
        {automationPanel}
        <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
          <Spinner /> Loading ideas…
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        {toolbar}
        {automationPanel}
        <ErrorPanel message={error} onRetry={load} />
      </div>
    );
  }

  const lists: Record<TabKey, IdeaSummary[]> = {
    waiting: data?.waiting ?? [],
    approved: data?.approved ?? [],
    redraft: data?.redraft ?? [],
    closed: data?.closed ?? [],
  };

  const tabs = (Object.keys(TAB_LABELS) as TabKey[]).map((key) => ({
    key,
    label: TAB_LABELS[key],
    count: lists[key].length,
  }));

  const current = lists[tab];

  return (
    <div>
      {toolbar}
      {automationPanel}
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {current.length === 0 ? (
        <EmptyState message={EMPTY_COPY[tab]} />
      ) : (
        <div className="space-y-3">
          {current.map((idea) => (
            <IdeaCard key={idea.number} idea={idea} project={project} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
