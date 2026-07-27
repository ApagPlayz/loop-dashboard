"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import type { IdeasPayload, IdeaSummary } from "@/lib/queues";
import { useProject } from "@/components/project-context";
import { TabBar, ErrorPanel, EmptyState, Spinner } from "./ui";
import { ToastProvider } from "./toast";
import IdeaCard from "./idea-card";
import CustomIdea from "./custom-idea";
import AutomationPanel from "./automation-panel";
import ScoutSettings from "./scout-settings";

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
  closed: "No recently closed or declined ideas.",
};

export default function IdeasView() {
  return (
    <ToastProvider>
      <IdeasInner />
    </ToastProvider>
  );
}

function IdeasInner() {
  // The loaded payload is stamped with the project it belongs to, so a
  // project switch can never render the previous project's cards (which,
  // before this, could put an Approve button over the same-numbered issue in
  // the WRONG repo).
  const [loaded, setLoaded] = useState<{ project: string; payload: IdeasPayload } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("waiting");
  const [showCustom, setShowCustom] = useState(false);
  const { project, current } = useProject();

  // Every fetch takes a ticket. Only the holder of the CURRENT ticket may touch
  // state — without this, switching project A → B while A was in flight let A's
  // slower response land last and set loaded = {A, …}. The `loaded.project`
  // check below then hid it, so the screen sat on data = null, loading = false,
  // error = null: permanently empty tabs with no spinner and no retry.
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const data = loaded && loaded.project === project ? loaded.payload : null;

  const load = useCallback(async () => {
    if (!project) return;
    const forProject = project;
    const myId = ++reqIdRef.current;
    // Superseded request: stop it on the wire too, not just at the state gate.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Drop any payload belonging to a different project before refetching, so
    // nothing stale can be rendered (or acted on) under the new one.
    setLoaded((prev) => (prev && prev.project === forProject ? prev : null));
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ideas?project=${encodeURIComponent(forProject)}`,
        { signal: controller.signal },
      );
      // A non-JSON failure (500 HTML page) must not become a SyntaxError.
      const payload = await res.json().catch(() => ({}));
      if (reqIdRef.current !== myId) return; // superseded — discard silently
      if (!res.ok) throw new Error(payload.error ?? "Failed to load ideas");
      setLoaded({ project: forProject, payload: payload as IdeasPayload });
    } catch (err) {
      if (reqIdRef.current !== myId) return; // superseded — discard silently
      setError(err instanceof Error ? err.message : "Failed to load ideas");
    } finally {
      // Only the latest request may clear the spinner.
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    // Defer so we don't call setState synchronously inside the effect body.
    // `load` itself drops any payload from the previous project first.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Unmount only — a switch is already handled inside `load`.
  useEffect(() => () => abortRef.current?.abort(), []);

  const projectLabel = current?.label ?? project;

  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
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

  const panels = (
    <>
      <AutomationPanel
        project={project}
        projectLabel={projectLabel}
        waitingCount={data?.waiting?.length ?? 0}
      />
      <ScoutSettings project={project} projectLabel={projectLabel} />
    </>
  );

  if (error && !data) {
    return (
      <div>
        {toolbar}
        {panels}
        <ErrorPanel message={error} onRetry={load} />
      </div>
    );
  }

  // No data and no error means a fetch is running, or is about to on the tick
  // right after a project switch. Show the spinner rather than falling through
  // to four empty tabs — this state never means "nothing here".
  if (!data) {
    return (
      <div>
        {toolbar}
        {panels}
        <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
          <Spinner /> Loading ideas…
        </div>
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

  const visible = lists[tab];

  return (
    <div>
      {toolbar}
      {panels}
      {loading && (
        <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
          <Spinner /> Refreshing…
        </div>
      )}
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {visible.length === 0 ? (
        <EmptyState message={EMPTY_COPY[tab]} />
      ) : (
        <div className="space-y-3">
          {visible.map((idea) => (
            <IdeaCard
              // Keyed by project AND number: two projects can hold the same
              // issue number, and React would otherwise reuse the card (and
              // its chat/comment state) across the switch.
              key={`${project}:${idea.number}`}
              idea={idea}
              project={project}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
