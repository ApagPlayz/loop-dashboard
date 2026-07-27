import { NextResponse } from "next/server";
import {
  createComment,
  mergePR,
  dispatchWorkflow,
  addLabel,
  removeLabel,
  getOctokit,
} from "@/lib/github";
import { loadPRDetail, closePR, getIssue, reopenIssue } from "@/lib/queues";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** GET /api/builds/[pr] — full detail: stats, verdict, demo evidence, thread. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ pr: string }> },
) {
  const { pr } = await params;
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) {
    return NextResponse.json({ error: "Bad PR number" }, { status: 400 });
  }
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const detail = await loadPRDetail(prNumber, repo);
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

type ActionBody = {
  action:
    | "merge"
    | "sendback"
    | "close"
    | "comment"
    | "redemo"
    | "reaudit"
    | "rebuild";
  text?: string;
  wakeClaude?: boolean;
};

/**
 * POST /api/builds/[pr] — the decision row.
 *  merge    : squash-merge the PR
 *  sendback : required text → posts "@claude <changes>" so the mention agent fixes it
 *  close    : optional comment, then close without merging
 *  comment  : plain comment (optionally @claude to wake the agent)
 *  redemo   : dispatch claude-demo.yml with pr_number to (re)capture evidence
 *  reaudit  : dispatch claude-audit.yml with pr_number to (re)review the PR
 *  rebuild  : PR conflicts with main and can't be merged as-is — close it and
 *             re-queue its source idea (re-approve) so the Builder recreates
 *             it fresh against current main instead of patching the old branch.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ pr: string }> },
) {
  const { pr } = await params;
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) {
    return NextResponse.json({ error: "Bad PR number" }, { status: 400 });
  }

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // Inside the try: resolveProjectFromUrl THROWS a ProjectError for a missing
    // (400) / unknown (404) project or an unreadable registry (502). Outside it,
    // that throw escaped the handler as an opaque 500 with no message.
    const { repo } = await resolveProjectFromUrl(req.url);

    switch (body.action) {
      case "merge": {
        try {
          const result = await mergePR(prNumber, { merge_method: "squash", repo });
          return NextResponse.json({ ok: true, merged: result.merged });
        } catch (err) {
          // 405 = not mergeable (conflicts / checks); surface GitHub's message.
          const status =
            (err as { status?: number })?.status === 405 ? 409 : 502;
          return NextResponse.json({ error: msg(err) }, { status });
        }
      }
      case "sendback": {
        const text = (body.text ?? "").trim();
        if (!text) {
          return NextResponse.json(
            { error: "Describe the changes you want first." },
            { status: 400 },
          );
        }
        await createComment(prNumber, `@claude ${text}`, repo);
        return NextResponse.json({ ok: true });
      }
      case "close": {
        const text = (body.text ?? "").trim();
        if (text) await createComment(prNumber, text, repo);
        await closePR(prNumber, repo);
        return NextResponse.json({ ok: true });
      }
      case "comment": {
        const text = (body.text ?? "").trim();
        if (!text) {
          return NextResponse.json(
            { error: "Write a comment first." },
            { status: 400 },
          );
        }
        await createComment(
          prNumber,
          body.wakeClaude ? `@claude ${text}` : text,
          repo,
        );
        return NextResponse.json({ ok: true });
      }
      case "redemo": {
        await dispatchWorkflow(
          "claude-demo.yml",
          "main",
          { pr_number: String(prNumber) },
          repo,
        );
        return NextResponse.json({ ok: true });
      }
      case "reaudit": {
        await dispatchWorkflow(
          "claude-audit.yml",
          "main",
          { pr_number: String(prNumber) },
          repo,
        );
        return NextResponse.json({ ok: true });
      }
      case "rebuild": {
        const prRes = await getOctokit().rest.pulls.get({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: prNumber,
        });
        const source = prRes.data;
        const ideaNumber = findSourceIdea(
          source.body ?? "",
          source.title ?? "",
          source.head.ref ?? "",
        );
        if (!ideaNumber) {
          return NextResponse.json(
            {
              error:
                "Couldn't find the source idea for this PR; close it manually.",
            },
            { status: 422 },
          );
        }

        await createComment(
          prNumber,
          "🔁 Closing this PR — it conflicts with the latest `main` and can't be merged as-is. " +
            `Sending idea #${ideaNumber} back through the loop so the Builder rebuilds it fresh against current main.`,
          repo,
        );
        await closePR(prNumber, repo);

        const idea = await getIssue(ideaNumber, repo);
        if (idea.state === "closed") {
          await reopenIssue(ideaNumber, repo);
        }
        // Re-adding a label the issue ALREADY carries emits no `issues:
        // labeled` event, so on an idea that was still `approved` this whole
        // action used to be silent and the rebuild waited on a cron GitHub
        // drops regularly. Drop the label first so the re-add is a real event,
        // then dispatch the Builder explicitly as well — belt and braces,
        // because the Builder's own gate skips ideas that already have an open
        // `claude/` PR, and we have just closed this one.
        for (const stale of ["approved", "proposal", "redraft", "declined"]) {
          await removeLabel(ideaNumber, stale, repo).catch(ignoreMissingLabel);
        }
        await addLabel(ideaNumber, "approved", repo);
        await createComment(
          ideaNumber,
          "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
          repo,
        );

        let dispatched = true;
        try {
          await dispatchWorkflow("claude-builder.yml", "main", {}, repo);
        } catch (err) {
          dispatched = false;
          console.warn(
            `builds: couldn't dispatch claude-builder.yml on ${repo.owner}/${repo.repo}`,
            err,
          );
        }

        return NextResponse.json({ ok: true, requeued: ideaNumber, dispatched });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

function msg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "GitHub request failed. Try again in a moment.";
}

/**
 * Find the source idea (issue) number for a Builder PR, in order of
 * confidence:
 *  1. A GitHub closing keyword in the PR body — "closes #12", "fixes #12", etc.
 *  2. A trailing "(#12)" in the PR title.
 *  3. A trailing "-12" on the head branch (e.g. "claude/add-thing-12").
 */
function findSourceIdea(
  body: string,
  title: string,
  headRef: string,
): number | null {
  const bodyMatch = body.match(
    /(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i,
  );
  if (bodyMatch) return Number(bodyMatch[2]);

  const titleMatch = title.match(/\(#(\d+)\)/);
  if (titleMatch) return Number(titleMatch[1]);

  const branchMatch = headRef.match(/-(\d+)$/);
  if (branchMatch) return Number(branchMatch[1]);

  return null;
}

function ignoreMissingLabel(err: unknown) {
  // Removing a label that isn't present returns 404 — harmless here.
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: number }).status === 404
  ) {
    return;
  }
  throw err;
}
