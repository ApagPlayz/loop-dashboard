import { NextResponse } from "next/server";
import { getWorkflowRuns } from "@/lib/github";
import { listRunJobs, toRunSummary } from "@/lib/testing";

export const dynamic = "force-dynamic";

/**
 * Test suite (repo-tests.yml) status: the latest run with its per-step
 * (install / lint / tests / build) results, plus a compact history of the last
 * 10 runs. If the workflow isn't on main yet, returns { notLive: true }.
 */
export async function GET() {
  try {
    const runs = await getWorkflowRuns({
      workflowId: "repo-tests.yml",
      per_page: 10,
    });
    if (runs.length === 0) {
      return NextResponse.json({ notLive: true, history: [] });
    }
    const history = runs.map(toRunSummary);
    const latest = history[0];
    // Pull the step-level breakdown from the latest run's jobs.
    const jobs = await listRunJobs(latest.id);
    const steps = jobs.flatMap((j) => j.steps);
    return NextResponse.json({ latest, history, steps });
  } catch (err: unknown) {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? (err as { status?: number }).status
        : undefined;
    if (status === 404) {
      return NextResponse.json({ notLive: true, history: [] });
    }
    return NextResponse.json(
      { error: "Could not load test results." },
      { status: 500 },
    );
  }
}
