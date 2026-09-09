import { NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import { resolveProject, ProjectError } from "@/lib/projects";
import { setWorkflowEnabled } from "@/lib/map-power";
import { invalidateHealth, sweepLoopHealth } from "@/lib/loop-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The loop preflight endpoint — see lib/loop-health.ts for the reasoning behind
 * the checks themselves.
 *
 * ## Auth
 *
 * There is deliberately no auth check in this file. That is not an omission:
 * `proxy.ts` denies every anonymous `/api/*` request that has no demo fixture,
 * BEFORE any handler runs (see lib/public-access.ts). A new route is therefore
 * unreachable to a signed-out visitor by default, and this one is given no
 * fixture, so it stays that way. `tests/lib/public-access.test.ts` walks
 * `app/api/**` on disk and fails if that ever stops being true. This route
 * handles auth exactly the way `app/api/map/power/route.ts` does — by not
 * being reachable without a session — and the permission model is the same
 * one: whatever the dashboard's `GITHUB_TOKEN` PAT is allowed to do.
 *
 * ## No Claude, no model, no CLAUDE_CODE_OAUTH_TOKEN
 *
 * The whole point of this endpoint is to diagnose a broken loop, and a missing
 * `CLAUDE_CODE_OAUTH_TOKEN` is the most common way one breaks. Anything here
 * that needed the token, or a model call, would fail for precisely the reason
 * it exists to report. Plain GitHub reads only.
 */

/**
 * GET /api/map/health              — preflight every registered project
 * GET /api/map/health?project=<key> — preflight just that one
 *
 * Returns: LoopHealthPayload — { projects: LoopHealth[], checkedAt }
 *
 * Always 200 with a body when the registry is readable, even when individual
 * projects are broken: a project that could not be checked comes back with
 * verdict "unknown" and a `check-failed` fault saying which check failed and
 * why. One bad repo never costs the owner the rest of the board.
 *
 * Results are memoised in-process (60s, 15s for "unknown") — see the cache
 * notes in lib/loop-health.ts. `?force=1` bypasses that, for the refresh button.
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const projectKey = params.get("project");

    // Resolve first when one project was named, so an unknown key is a clean
    // 404 rather than a silently empty list.
    if (projectKey !== null) await resolveProject(projectKey);

    const payload = await sweepLoopHealth({
      projectKey,
      force: params.get("force") === "1",
    });
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("health: sweep failed", err);
    return NextResponse.json(
      { error: "Couldn't run the loop preflight. Try again." },
      { status: 502 },
    );
  }
}

/**
 * POST /api/map/health — the one-click repairs.
 *
 * Body: { project: string, action: "enable-workflows", files: string[] }
 *       { project: string, action: "rerun", runId: number }
 *
 * Returns: { ok: true, changed: string[] } | { ok: true, runId: number }
 *
 * NOTHING in this feature auto-repairs. Every check in lib/loop-health.ts is
 * read-only, and the only way a workflow gets switched back on or a run gets
 * retried is an explicit POST from a click. That is a deliberate line: a health
 * board that quietly re-enabled workflows would undo a deliberate `disabled`
 * decision (exactly the mistake lib/map-power.ts's pause record exists to
 * prevent) and would make the board's own readings untrustworthy — you could
 * never tell a green project from one the board had just papered over.
 *
 * "enable-workflows" only ever ENABLES. There is no disable path here; the
 * power menu owns switching things off, and it records what it turned off.
 */
export async function POST(req: Request) {
  try {
    let body: { project?: unknown; action?: unknown; files?: unknown; runId?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }

    const projectKey = typeof body.project === "string" ? body.project : null;
    const { repo } = await resolveProject(projectKey);

    if (body.action === "enable-workflows") {
      const files = Array.isArray(body.files) ? body.files : [];
      if (files.length === 0) {
        return NextResponse.json({ error: "No workflows named." }, { status: 400 });
      }
      // Same filename guard the power route uses. These strings become a URL
      // path segment on GitHub, so they are validated rather than trusted.
      for (const file of files) {
        if (typeof file !== "string" || !/^[A-Za-z0-9._-]+\.ya?ml$/.test(file)) {
          return NextResponse.json({ error: "Invalid workflow name." }, { status: 400 });
        }
      }
      for (const file of files as string[]) {
        await setWorkflowEnabled(repo, file, true);
      }
      invalidateHealth(projectKey!);
      return NextResponse.json({ ok: true, changed: files });
    }

    if (body.action === "rerun") {
      const runId = body.runId;
      if (typeof runId !== "number" || !Number.isSafeInteger(runId) || runId <= 0) {
        return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
      }
      await getOctokit().rest.actions.reRunWorkflow({
        owner: repo.owner,
        repo: repo.repo,
        run_id: runId,
      });
      invalidateHealth(projectKey!);
      return NextResponse.json({ ok: true, runId });
    }

    return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("health: repair failed", err);
    return NextResponse.json(
      { error: "Couldn't apply that fix on GitHub. Try again." },
      { status: 502 },
    );
  }
}
