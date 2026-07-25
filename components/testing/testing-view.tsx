"use client";

import { useState } from "react";
import { Rocket, ClipboardCheck, History } from "lucide-react";
import { useProject } from "@/components/project-context";
import RunAgents from "./run-agents";
import TestSuite from "./test-suite";
import InstructionChanges from "./instruction-changes";

const TABS = [
  { key: "run", label: "Run an agent", icon: Rocket },
  { key: "suite", label: "Test suite", icon: ClipboardCheck },
  { key: "changes", label: "Instruction changes", icon: History },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function TestingView() {
  const [tab, setTab] = useState<TabKey>("run");
  const { project } = useProject();
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2 border-b border-zinc-800 pb-3">
        {TABS.map((t) => {
          const active = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-emerald-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "run" && <RunAgents project={project} />}
      {tab === "suite" && <TestSuite project={project} />}
      {tab === "changes" && <InstructionChanges project={project} />}
    </div>
  );
}
