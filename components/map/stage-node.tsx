"use client";

import { memo } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import NodeHandles from "./node-handles";

export type StageNodeData = {
  label: string;
  sub?: string;
  href?: string;
  badgeValue?: number | null;
  badgeLabel?: string;
  loading?: boolean;
};

/**
 * A stage node (Ideas queue, Pull request, decision points, Merged). Visually
 * distinct from agent nodes: a flatter, cooler card. Deep-links into the
 * matching dashboard section when it has an href.
 */
function StageNode({ data }: { data: StageNodeData }) {
  const { label, sub, href, badgeValue, badgeLabel, loading } = data;

  const inner = (
    <div className="group relative w-44 rounded-xl border border-dashed border-zinc-600 bg-zinc-800/40 p-3 text-center shadow-md transition hover:border-emerald-500/50 hover:bg-zinc-800/70">
      <NodeHandles />
      <div className="flex items-center justify-center gap-1 text-sm font-semibold text-zinc-100">
        {label}
        {href && (
          <ArrowUpRight className="h-3.5 w-3.5 text-zinc-500 transition group-hover:text-emerald-400" />
        )}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>}
      {typeof badgeValue !== "undefined" && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
          {loading && badgeValue === null ? "…" : badgeValue ?? 0}
          {badgeLabel && <span className="text-emerald-500/70">{badgeLabel}</span>}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block no-underline">
        {inner}
      </Link>
    );
  }
  return inner;
}

export default memo(StageNode);
