import { Suspense } from "react";
import { KeyRound, Activity, LayoutGrid } from "lucide-react";
import PageHeader from "@/components/page-header";
import AddToolForm from "@/components/tools/add-tool-form";
import NeedsYou from "@/components/tools/needs-you";
import InstallActivity from "@/components/tools/install-activity";
import CapabilityInventory from "@/components/tools/capability-inventory";

// Inventory reads live YAML from GitHub on each request.
export const dynamic = "force-dynamic";

export default function ToolsPage() {
  return (
    <>
      <PageHeader
        title="Tools"
        description="Give your agents a new skill, MCP server, or plugin — and see what they can do today."
      />

      <div className="space-y-10">
        {/* Add a tool */}
        <AddToolForm />

        {/* Needs you */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-200">
            <KeyRound className="h-4 w-4 text-amber-400" />
            Needs you
          </h2>
          <NeedsYou />
        </section>

        {/* Install activity */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
            <Activity className="h-4 w-4 text-zinc-500" />
            Install activity
          </h2>
          <InstallActivity />
        </section>

        {/* Inventory */}
        <section>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-300">
            <LayoutGrid className="h-4 w-4 text-zinc-500" />
            What your agents can do today
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            The tools each agent is allowed to use, read straight from its setup.
          </p>
          <Suspense
            fallback={
              <p className="text-sm text-zinc-500">Reading agent setup…</p>
            }
          >
            <CapabilityInventory />
          </Suspense>
        </section>
      </div>
    </>
  );
}
