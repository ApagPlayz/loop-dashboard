"use client";

import { useCallback, useEffect, useState } from "react";
import type { IdeasPayload, IdeaSummary } from "@/lib/queues";
import { TabBar, ErrorPanel, EmptyState, Spinner } from "./ui";
import { ToastProvider } from "./toast";
import IdeaCard from "./idea-card";

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ideas");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to load ideas");
      setData(payload as IdeasPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ideas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer so we don't call setState synchronously inside the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
        <Spinner /> Loading ideas…
      </div>
    );
  }

  if (error && !data) {
    return <ErrorPanel message={error} onRetry={load} />;
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
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {current.length === 0 ? (
        <EmptyState message={EMPTY_COPY[tab]} />
      ) : (
        <div className="space-y-3">
          {current.map((idea) => (
            <IdeaCard key={idea.number} idea={idea} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
