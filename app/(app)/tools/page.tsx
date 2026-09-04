import { Suspense } from "react";
import { cookies } from "next/headers";
import { KeyRound, Activity, LayoutGrid, Compass } from "lucide-react";
import PageHeader from "@/components/page-header";
import { PROJECT_COOKIE } from "@/lib/project-cookie";
import { defaultProjectKey } from "@/lib/projects";
import AddToolForm from "@/components/tools/add-tool-form";
import FitScan from "@/components/tools/fit-scan";
import ToolCatalogModal from "@/components/tools/tool-catalog-modal";
import NeedsYou from "@/components/tools/needs-you";
import InstallActivity from "@/components/tools/install-activity";
import CapabilityInventory from "@/components/tools/capability-inventory";

// Inventory reads live YAML from GitHub on each request.
export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  // The inventory is a server component, so it can't read useProject(); it gets
  // the same selection off the cookie the switcher writes (same rule as Metrics:
  // the saved project if it still exists, else the first registered one).
  const cookieStore = await cookies();
  const projectKey = await defaultProjectKey(
    cookieStore.get(PROJECT_COOKIE)?.value,
  );

  return (
    <>
      <PageHeader
        title="Tools"
        description="Give your agents a new skill, MCP server, or plugin — and see what they can do today."
      />

      <div className="space-y-10">
        {/* Give ALL agents a tool by pasting a link. To target a single agent,
            open it on the Process Map → Install tools tab. */}
        <AddToolForm allMode />

        {/* Discover + browse tools */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
            <Compass className="h-4 w-4 text-zinc-500" />
            Find &amp; browse tools
          </h2>
          <div className="space-y-3">
            <FitScan />
            <ToolCatalogModal />
          </div>
        </section>

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
          <Suspense fallback={<p className="text-sm text-zinc-500">Reading agent setup…</p>}>
            <CapabilityInventory projectKey={projectKey} />
          </Suspense>
        </section>
      </div>
    </>
  );
}
