"use client";

import { useCallback, useEffect, useState } from "react";
import type { BuildsPayload, PRSummary } from "@/lib/queues";
import { TabBar, ErrorPanel, EmptyState, Spinner } from "./ui";
import { ToastProvider } from "./toast";
import PRCard from "./pr-card";

type TabKey = "needsReview" | "merged" | "closed";

const TAB_LABELS: Record<TabKey, string> = {
  needsReview: "Needs your review",
  merged: "Recently merged",
  closed: "Closed, not merged",
};

const EMPTY_COPY: Record<TabKey, string> = {
  needsReview: "No pull requests waiting on you right now.",
  merged: "Nothing merged recently.",
  closed: "No PRs were closed without merging.",
};

export default function BuildsView() {
  return (
    <ToastProvider>
      <BuildsInner />
    </ToastProvider>
  );
}

function BuildsInner() {
  const [data, setData] = useState<BuildsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("needsReview");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/builds");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to load builds");
      setData(payload as BuildsPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load builds");
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
        <Spinner /> Loading pull requests…
      </div>
    );
  }

  if (error && !data) {
    return <ErrorPanel message={error} onRetry={load} />;
  }

  const lists: Record<TabKey, PRSummary[]> = {
    needsReview: data?.needsReview ?? [],
    merged: data?.merged ?? [],
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
          {current.map((pr) => (
            <PRCard key={pr.number} pr={pr} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
