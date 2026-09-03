import { Cpu, Server, Sparkles, Users } from "lucide-react";
import {
  loadCapabilityInventory,
  type AgentCapabilities,
  type SharedCapabilities,
} from "@/lib/tools";
import { resolveProject } from "@/lib/projects";
import PromoteChip from "@/components/tools/promote-chip";
import AddToolForm from "@/components/tools/add-tool-form";
import RequestChange from "@/components/tools/request-change";
import { isPublicViewer } from "@/lib/demo/viewer";
import { DEMO_CAPABILITY_INVENTORY } from "@/lib/demo/fixtures-pages";

type Kind = "tool" | "mcp" | "skill";

const TONE: Record<Kind, string> = {
  mcp: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  skill: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  tool: "border-zinc-700 bg-zinc-800 text-zinc-300",
};

function Chip({ children, kind }: { children: React.ReactNode; kind: Kind }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[kind]}`}
    >
      {children}
    </span>
  );
}

function Group({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {icon} {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/* ---------- shared panel ---------- */

function SharedPanel({ shared }: { shared: SharedCapabilities }) {
  const hasAny =
    shared.builtinTools.length > 0 ||
    shared.mcpServers.length > 0 ||
    shared.skills.length > 0;
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
        <Users className="h-4 w-4 text-emerald-400" />
        Shared by all agents
      </h3>
      <p className="mt-1 text-xs text-zinc-400">
        Every agent can do this today. Add a tool here to give it to all of them
        at once.
      </p>

      <div className="mt-4 space-y-3">
        {!hasAny ? (
          <p className="text-xs text-zinc-500">
            No capability is shared by every agent yet.
          </p>
        ) : (
          <>
            {shared.builtinTools.length > 0 && (
              <Group icon={<Cpu className="h-3 w-3" />} label="Built-in tools">
                {shared.builtinTools.map((t) => (
                  <Chip key={t} kind="tool">
                    {t}
                  </Chip>
                ))}
              </Group>
            )}
            {shared.mcpServers.length > 0 && (
              <Group icon={<Server className="h-3 w-3" />} label="MCP servers">
                {shared.mcpServers.map((t) => (
                  <Chip key={t} kind="mcp">
                    {t}
                  </Chip>
                ))}
              </Group>
            )}
            {shared.skills.length > 0 && (
              <Group icon={<Sparkles className="h-3 w-3" />} label="Skills">
                {shared.skills.map((t) => (
                  <Chip key={t} kind="skill">
                    {t}
                  </Chip>
                ))}
              </Group>
            )}
          </>
        )}
      </div>

      <div className="mt-5">
        <AddToolForm allMode />
      </div>
      <RequestChange />
    </div>
  );
}

/* ---------- per-agent card ---------- */

function AgentCard({
  a,
  shared,
}: {
  a: AgentCapabilities;
  shared: SharedCapabilities;
}) {
  const sharedTools = new Set(shared.builtinTools);
  const sharedMcp = new Set(shared.mcpServers);
  const sharedSkills = new Set(shared.skills);

  const hasAny =
    a.builtinTools.length > 0 || a.mcpServers.length > 0 || a.skills.length > 0;

  // Render a shared item as a plain chip; a non-shared item as a PromoteChip.
  const render = (name: string, kind: Kind, sharedSet: Set<string>) =>
    sharedSet.has(name) ? (
      <Chip key={name} kind={kind}>
        {name}
      </Chip>
    ) : (
      <PromoteChip key={name} name={name} kind={kind} fromAgent={a.name} />
    );

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{a.name}</h3>
          <p className="text-xs text-zinc-500">{a.blurb}</p>
        </div>
        {a.model && (
          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
            {a.model}
          </span>
        )}
      </div>

      {!a.isAgent ? (
        <p className="mt-3 text-xs text-zinc-500">
          Runs a plain script — no AI agent.
        </p>
      ) : !hasAny ? (
        <p className="mt-3 text-xs text-zinc-500">Standard toolkit.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {a.builtinTools.length > 0 && (
            <Group icon={<Cpu className="h-3 w-3" />} label="Built-in tools">
              {a.builtinTools.map((t) => render(t, "tool", sharedTools))}
            </Group>
          )}
          {a.mcpServers.length > 0 && (
            <Group icon={<Server className="h-3 w-3" />} label="MCP servers">
              {a.mcpServers.map((t) => render(t, "mcp", sharedMcp))}
            </Group>
          )}
          {a.skills.length > 0 && (
            <Group icon={<Sparkles className="h-3 w-3" />} label="Skills">
              {a.skills.map((t) => render(t, "skill", sharedSkills))}
            </Group>
          )}
        </div>
      )}

      {a.source !== "main" && (
        <p className="mt-3 text-[10px] text-amber-300/70">
          Read from a pending branch — not on main yet.
        </p>
      )}
    </div>
  );
}

/**
 * Reads one project's agent setup. `projectKey` is required and resolved here
 * (inside the Suspense boundary, so the rest of the page still streams) — the
 * inventory used to read the pilot's workflows whatever the switcher said.
 */
export default async function CapabilityInventory({
  projectKey,
}: {
  projectKey: string;
}) {
  let agents: AgentCapabilities[] = [];
  let shared: SharedCapabilities = { builtinTools: [], mcpServers: [], skills: [] };
  let error = false;

  if (await isPublicViewer()) {
    // Demo: loadCapabilityInventory() reads .github/workflows/*.yml straight
    // off GitHub, which 404s for the fictional demo repo (and isn't proxied —
    // only /api/* requests are). Show the frozen inventory instead.
    ({ agents, shared } = DEMO_CAPABILITY_INVENTORY);
  } else {
    try {
      const { repo } = await resolveProject(projectKey);
      ({ agents, shared } = await loadCapabilityInventory(repo));
    } catch {
      error = true;
    }
  }

  if (error) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">
        Couldn&apos;t read the agents&apos; setup from GitHub right now.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <SharedPanel shared={shared} />
      <div>
        <p className="mb-2 text-xs text-zinc-500">
          Per agent — the{" "}
          <span className="inline-flex items-center gap-0.5 text-zinc-400">
            +
          </span>{" "}
          on a chip gives that tool to every agent.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <AgentCard key={a.file} a={a} shared={shared} />
          ))}
        </div>
      </div>
    </div>
  );
}
