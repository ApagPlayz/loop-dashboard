"use client";

import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, X, Loader2, Circle } from "lucide-react";
import type { AgentStatus } from "@/lib/map-types";
import { relativeTime, runTone } from "./format";
import NodeHandles from "./node-handles";

export type AgentNodeData = {
  label: string;
  tagline: string;
  Icon: LucideIcon;
  status?: AgentStatus | null;
  loading?: boolean;
  onMain: boolean;
};

/**
 * An agent workflow node: title, one-line job, and a live status pill. Clicking
 * it opens the drawer (handled by the parent via React Flow's onNodeClick).
 */
function AgentNode({ data }: { data: AgentNodeData }) {
  const { label, tagline, Icon, status, loading, onMain } = data;
  const tone = runTone(status?.status ?? null, status?.conclusion ?? null);
  const disabled = status ? status.enabled === false : false;

  return (
    <div
      className={`w-52 cursor-pointer rounded-xl border p-3 shadow-lg transition hover:border-emerald-500/60 hover:bg-zinc-800/80 ${
        disabled
          ? "border-zinc-800 bg-zinc-900/50 opacity-50 saturate-0"
          : "border-zinc-700 bg-zinc-900"
      }`}
    >
      <NodeHandles />
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-100">{label}</div>
          <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-zinc-400">{tagline}</div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-zinc-800 pt-2 text-[11px]">
        {disabled ? (
          <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 font-medium text-zinc-300">
            Switched off
          </span>
        ) : !onMain ? (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-400">
            Not installed yet
          </span>
        ) : loading && !status ? (
          <span className="flex items-center gap-1 text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </span>
        ) : tone === "running" ? (
          <span className="flex items-center gap-1 font-medium text-sky-400">
            <Loader2 className="h-3 w-3 animate-spin" /> Running now
          </span>
        ) : tone === "success" ? (
          <span className="flex items-center gap-1 font-medium text-emerald-400">
            <Check className="h-3 w-3" /> Passed
            <span className="text-zinc-500">· {relativeTime(status?.createdAt ?? null)}</span>
          </span>
        ) : tone === "failure" ? (
          <span className="flex items-center gap-1 font-medium text-red-400">
            <X className="h-3 w-3" /> Failed
            <span className="text-zinc-500">· {relativeTime(status?.createdAt ?? null)}</span>
          </span>
        ) : status?.createdAt ? (
          <span className="flex items-center gap-1 text-zinc-500">
            <Circle className="h-3 w-3" /> {relativeTime(status.createdAt)}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-zinc-500">
            <Circle className="h-3 w-3" /> Not run yet
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(AgentNode);
