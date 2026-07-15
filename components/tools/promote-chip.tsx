"use client";

import { useState } from "react";
import { PlusCircle, Check } from "lucide-react";

const TONE: Record<string, string> = {
  mcp: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  skill: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  tool: "border-zinc-700 bg-zinc-800 text-zinc-300",
};

/**
 * A capability chip that only some agents have, with a "give to all" action
 * that replicates it onto every agent via the tool-install event.
 */
export default function PromoteChip({
  name,
  kind,
  fromAgent,
}: {
  name: string;
  kind: "tool" | "mcp" | "skill";
  fromAgent: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function promote() {
    setState("busy");
    try {
      const res = await fetch("/api/tools/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, fromAgent }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <span
      className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[kind]}`}
    >
      {name}
      {state === "done" ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <button
          onClick={promote}
          disabled={state === "busy"}
          title="Give this to all agents"
          className="opacity-60 hover:opacity-100 disabled:opacity-30"
        >
          <PlusCircle className="h-3 w-3" />
        </button>
      )}
      {state === "error" && <span className="text-red-300">!</span>}
    </span>
  );
}
