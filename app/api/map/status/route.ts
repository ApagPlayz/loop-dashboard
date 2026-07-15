import { NextResponse } from "next/server";
import { listIssues, listPRs, getWorkflowRuns } from "@/lib/github";
import { aiEnabled } from "@/lib/map-ai";
import { AGENTS } from "@/lib/map-agents";
import type { AgentStatus, MapStatus } from "@/lib/map-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/map/status
 * Live badges for the map: open idea count, approved count, open claude/ PR
 * count, and each agent's latest run status. Best-effort — a partial failure
 * still returns usable data plus a `warning`.
 */
export async function GET() {
  try {
    const warnings: string[] = [];

    const [proposals, approved, prs, ...runsPerAgent] = await Promise.all([
      listIssues("proposal").catch((e) => {
        warnings.push("Couldn't load open ideas.");
        console.error("status: proposals", e);
        return [] as unknown[];
      }),
      listIssues("approved").catch((e) => {
        warnings.push("Couldn't load approved ideas.");
        console.error("status: approved", e);
        return [] as unknown[];
      }),
      listPRs({ state: "open" }).catch((e) => {
        warnings.push("Couldn't load pull requests.");
        console.error("status: prs", e);
        return [] as { head: { ref: string } }[];
      }),
      ...AGENTS.map((a) =>
        getWorkflowRuns({ workflowId: a.file, per_page: 1 })
          .then((runs) => ({ id: a.id, file: a.file, run: runs[0] ?? null }))
          .catch(() => ({ id: a.id, file: a.file, run: null })),
      ),
    ]);

    const openPRs = (prs as { head?: { ref?: string } }[]).filter((p) =>
      (p.head?.ref ?? "").startsWith("claude/"),
    ).length;

    const agents: AgentStatus[] = (
      runsPerAgent as { id: string; file: string; run: RunLike }[]
    ).map(({ id, file, run }) => ({
      id,
      file,
      status: run?.status ?? null,
      conclusion: run?.conclusion ?? null,
      createdAt: run?.created_at ?? null,
      url: run?.html_url ?? null,
    }));

    const body: MapStatus = {
      proposals: proposals.length,
      approved: approved.length,
      openPRs,
      agents,
      aiEnabled: aiEnabled(),
      warning: warnings.length ? warnings.join(" ") : undefined,
    };
    return NextResponse.json(body);
  } catch (err) {
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
