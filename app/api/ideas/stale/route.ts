import { NextResponse } from "next/server";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import { getLoopConfig } from "@/lib/loop-config";
import { listApprovedIdeas } from "@/lib/queues";
import {
  assessApprovedIdeas,
  isStaleCheckDue,
  resolveLastCheckedAt,
  type StalePreview,
} from "@/lib/idea-staleness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/ideas/stale?project=<key>
 *
 * A READ-ONLY preview of tier 1 of the stale check: which approved ideas have
 * had hand-written code land under them since they were approved, and why the
 * rule thinks so. It labels nothing, comments nothing, closes nothing — the
 * writing half of this feature lives in the Scout's hourly GitHub Actions run,
 * on purpose (see lib/idea-staleness.ts).
 *
 * Two reasons this endpoint exists rather than the screen simply reading the
 * `stale` label:
 *   1. The check is opt-in and it writes to the owner's issues. Being able to
 *      see exactly what it would flag, before switching it on, is the
 *      difference between a feature someone trusts and one they leave off.
 *   2. The Scout cron only runs in a target repo that has the workflow rolled
 *      out. This answers the question today, for any project, from here.
 *
 * It runs regardless of whether the check is enabled — `enabled` and `gate`
 * are reported so the UI can say what the automatic run WOULD do, which is a
 * different question from what the rule currently sees.
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);

    const [config, ideas, lastCheckedAt] = await Promise.all([
      getLoopConfig(repo),
      listApprovedIdeas(repo),
      resolveLastCheckedAt(repo),
    ]);

    const staleCheck = config.scout.staleCheck;
    const { branch, assessments } = await assessApprovedIdeas(ideas, repo);

    const payload: StalePreview = {
      enabled: staleCheck.enabled,
      intervalHours: staleCheck.intervalHours,
      branch,
      lastCheckedAt,
      gate: isStaleCheckDue(lastCheckedAt, staleCheck.intervalHours),
      checkedAt: new Date().toISOString(),
      ideas: assessments,
    };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("ideas/stale: preview failed", err);
    return NextResponse.json(
      { error: "Couldn't check the approved queue against GitHub. Try again." },
      { status: 502 },
    );
  }
}
