"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  MarkerType,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Telescope,
  PenLine,
  Hammer,
  ShieldCheck,
  Camera,
  RefreshCw,
  BarChart3,
  AtSign,
  PackagePlus,
  type LucideIcon,
} from "lucide-react";
import { MAP_NODES, MAP_EDGES, getAgent } from "@/lib/map-agents";
import type { MapStatus } from "@/lib/map-types";
import AgentNode from "./agent-node";
import StageNode from "./stage-node";
import AgentDrawer from "./agent-drawer";
import LoopEditPanel from "./loop-edit-panel";

const ICONS: Record<string, LucideIcon> = {
  scout: Telescope,
  redraft: PenLine,
  builder: Hammer,
  audit: ShieldCheck,
  demo: Camera,
  retro: RefreshCw,
  metrics: BarChart3,
  mention: AtSign,
  toolinstall: PackagePlus,
};

const nodeTypes = { agent: AgentNode, stage: StageNode };

const BADGE_LABEL: Record<string, string> = {
  proposals: "waiting",
  approved: "approved",
  openPRs: "open",
};

function buildNodes(status: MapStatus | null, loading: boolean): Node[] {
  return MAP_NODES.map((n) => {
    if (n.kind === "agent") {
      const meta = getAgent(n.agentId)!;
      const s = status?.agents.find((a) => a.id === meta.id) ?? null;
      return {
        id: n.id,
        type: "agent",
        position: { x: n.x, y: n.y },
        data: {
          agentId: meta.id,
          label: meta.label,
          tagline: meta.tagline,
          Icon: ICONS[meta.id],
          onMain: meta.onMain,
          status: s,
          loading,
        },
        draggable: false,
      } as Node;
    }
    const badgeValue =
      n.badge && status ? (status[n.badge] as number) : n.badge ? null : undefined;
    return {
      id: n.id,
      type: "stage",
      position: { x: n.x, y: n.y },
      data: {
        label: n.label,
        sub: n.sub,
        href: n.href,
        badgeValue,
        badgeLabel: n.badge ? BADGE_LABEL[n.badge] : undefined,
        loading,
      },
      draggable: false,
    } as Node;
  });
}

function buildEdges(): Edge[] {
  return MAP_EDGES.map((e) => {
    const flow = e.variant === "flow";
    const capability = e.variant === "capability";
    const color = flow ? "#34d399" : capability ? "#38bdf8" : "#a1a1aa";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: e.label,
      animated: flow,
      type: "default",
      style: {
        stroke: color,
        strokeWidth: flow ? 2 : 1.5,
        strokeDasharray: flow ? undefined : "5 5",
      },
      labelStyle: { fill: "#d4d4d8", fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: "#18181b", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    } as Edge;
  });
}

export default function ProcessMap() {
  const [status, setStatus] = useState<MapStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/map/status");
      if (!res.ok) throw new Error("bad status");
      const data: MapStatus = await res.json();
      setStatus(data);
      setStatusError(data.warning ?? null);
    } catch {
      setStatusError("Couldn't refresh live status. Showing what we have.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Poll GitHub for live status: a subscription to an external system. All
    // state updates happen after an await, not synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus();
    timer.current = setInterval(fetchStatus, 15000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [fetchStatus]);

  const edges = useMemo(() => buildEdges(), []);
  const nodes = useMemo(() => buildNodes(status, loading), [status, loading]);

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    if (node.type === "agent") {
      const agentId = (node.data as { agentId?: string }).agentId;
      if (agentId) setOpenAgent(agentId);
    }
    // Stage nodes navigate via their inner <Link>.
  }, []);

  return (
    <>
      {statusError && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {statusError}
        </div>
      )}
      <div className="h-[74vh] min-h-[480px] w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          className="[&_.react-flow__controls-button]:border-zinc-700 [&_.react-flow__controls-button]:bg-zinc-800 [&_.react-flow__controls-button]:fill-zinc-300 [&_.react-flow__controls-button:hover]:bg-zinc-700"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#3f3f46" />
          <Controls showInteractive={false} />
          <Panel position="top-left">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-[11px] text-zinc-400 backdrop-blur">
              <div className="mb-1 font-semibold text-zinc-300">How to read this</div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded bg-emerald-500/20 ring-1 ring-emerald-500/40" />
                Agent — tap for details &amp; controls
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-3.5 rounded border border-dashed border-zinc-500" />
                Stage — tap to open that section
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 bg-emerald-400" /> flow
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0 w-4 border-t border-dashed border-zinc-400" /> learns
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0 w-4 border-t border-dashed border-sky-400" /> abilities
                </span>
              </div>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* Improve-with-AI + loop history, below the map */}
      <LoopEditPanel aiEnabled={status ? status.aiEnabled : null} />

      <AgentDrawer agentId={openAgent} onClose={() => setOpenAgent(null)} onRan={fetchStatus} />
    </>
  );
}
