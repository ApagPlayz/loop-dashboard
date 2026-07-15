import { NextResponse } from "next/server";
import { listIssues, listPRs, getWorkflowRuns } from "@/lib/github";
import { aiEnabled } from "@/lib/map-ai";
import { resolveProjectFromUrl, getProjectAgents, ProjectError } from "@/lib/projects";
import { listLoopWorkflows } from "@/lib/map-power";
import type { AgentStatus, MapStatus } from "@/lib/map-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/status?project=<key>
 * Live badges for the map: open idea count, approved count, open claude/ PR
 * count, each agent's latest run status + on/off state, and whether the loop
 * is paused. Best-effort — a partial failure still returns usable data plus
 * a `warning`.
 */
export async function GET(req: Request) {
  try {
    const { project, repo } = await resolveProjectFromUrl(req.url);
    const agentsMeta = await getProjectAgents(project);
    const warnings: string[] = [];

    const [proposals, approved, prs, power, ...runsPerAgent] = await Promise.all([
      listIssues("proposal", { repo }).catch((e) => {
        warnings.push("Couldn't load open ideas.");
        console.error("status: proposals", e);
        return [] as unknown[];
      }),
      listIssues("approved", { repo }).catch((e) => {
        warnings.push("Couldn't load approved ideas.");
        console.error("status: approved", e);
        return [] as unknown[];
      }),
      listPRs({ state: "open", repo }).catch((e) => {
        warnings.push("Couldn't load pull requests.");
        console.error("status: prs", e);
        return [] as { head: { ref: string } }[];
      }),
      listLoopWorkflows(repo).catch((e) => {
        console.error("status: power", e);
        return null;
      }),
      ...agentsMeta.map((a) =>
        getWorkflowRuns({ workflowId: a.file, per_page: 1, repo })
          .then((runs) => ({ meta: a, run: runs[0] ?? null }))
          .catch(() => ({ meta: a, run: null })),
      ),
    ]);

    const openPRs = (prs as { head?: { ref?: string } }[]).filter((p) =>
      (p.head?.ref ?? "").startsWith("claude/"),
    ).length;

    const enabledByFile = new Map<string, boolean>();
    for (const w of power ?? []) enabledByFile.set(w.file, w.enabled);

    const agents: AgentStatus[] = (
      runsPerAgent as { meta: (typeof agentsMeta)[number]; run: RunLike }[]
    ).map(({ meta, run }) => ({
      id: meta.id,
      file: meta.file,
      label: meta.label,
      tagline: meta.tagline,
      generic: !!meta.generic,
      enabled: enabledByFile.get(meta.file) ?? true,
      status: run?.status ?? null,
      conclusion: run?.conclusion ?? null,
      createdAt: run?.created_at ?? null,
      url: run?.html_url ?? null,
    }));

    // Paused = every loop workflow except @mention is switched off.
    const pausable = (power ?? []).filter((w) => !w.isMention);
    const loopPaused = pausable.length > 0 && pausable.every((w) => !w.enabled);

    const body: MapStatus = {
      proposals: proposals.length,
      approved: approved.length,
      openPRs,
      agents,
      project: project.key,
      loopPaused,
      aiEnabled: aiEnabled(),
      warning: warnings.length ? warnings.join(" ") : undefined,
    };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("status: fatal", err);
    return NextResponse.json(
      { error: "Couldn't reach GitHub. Check the connection and try again." },
      { status: 502 },
    );
  }
}

type RunLike = {
  status?: string | null;
  conclusion?: string | null;
  created_at?: string | null;
  html_url?: string | null;
} | null;
