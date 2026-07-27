import { NextResponse } from "next/server";
import {
  createComment,
  setIssueLabels,
  dispatchWorkflow,
  type RepoConfig,
} from "@/lib/github";
import { listThreadComments, closeIssue, getIssue } from "@/lib/queues";
import { resolveProject, resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** GET /api/ideas/[number]?project=<key> — the comment thread for one idea. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  const issueNumber = Number(number);
  if (!Number.isInteger(issueNumber)) {
    return NextResponse.json({ error: "Bad issue number" }, { status: 400 });
  }
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const comments = await listThreadComments(issueNumber, repo);
    return NextResponse.json({ comments });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

type ActionBody = {
  /** `reject` is the legacy name for `decline` and behaves identically. */
  action: "approve" | "unapprove" | "redraft" | "decline" | "reject";
  text?: string;
  project?: string;
};

/** Every label this route owns — anything else on the issue is left alone. */
const QUEUE_LABELS = ["proposal", "approved", "redraft", "declined"] as const;

/**
 * The exact label set an issue should end up with after `action`, computed
 * from its CURRENT labels so the write is a single atomic `setLabels` rather
 * than an add + remove pair. Non-queue labels (`bug`, `area/*`, …) survive.
 */
function nextLabels(current: string[], keep: string): string[] {
  const out = current.filter(
    (l) => !(QUEUE_LABELS as readonly string[]).includes(l) || l === keep,
  );
  if (!out.includes(keep)) out.push(keep);
  return out;
}

/**
 * Wake a workflow explicitly instead of trusting the label write to do it.
 *
 * Re-applying a label the issue ALREADY carries emits no `issues: labeled`
 * event, so "approve an already-approved idea" and "send an idea back a second
 * time" were silent no-ops that waited on a cron GitHub drops regularly.
 * `alreadyHad` says whether we are in that case: when the label is genuinely
 * new the label event starts the workflow and dispatching too would just queue
 * a duplicate agent run, so we only dispatch when nothing else will.
 *
 * Best-effort either way — a repo that doesn't have that workflow file must
 * not fail the action the owner actually asked for.
 */
async function wake(
  workflow: string,
  repo: RepoConfig,
  alreadyHad: boolean,
  inputs: Record<string, string> = {},
): Promise<boolean> {
  if (!alreadyHad) return false;
  try {
    await dispatchWorkflow(workflow, "main", inputs, repo);
    return true;
  } catch (err) {
    console.warn(`ideas: couldn't dispatch ${workflow} on ${repo.owner}/${repo.repo}`, err);
    return false;
  }
}

/**
 * POST /api/ideas/[number] — mutate an idea.
 *  approve   : optional comment (e.g. an included chat transcript), labels →
 *              `approved`, then dispatch the Builder
 *  unapprove : labels → `proposal`
 *  redraft   : required feedback comment, labels → `redraft`, then dispatch
 *              the Redraft agent
 *  decline   : optional reason comment, labels → `declined`, close as
 *              `not_planned`. This is the loop's only "no" — the `declined`
 *              label is what makes a rejection legible to the Scout and keeps
 *              the idea in the Closed tab instead of vanishing.
 *  reject    : alias of `decline`, kept for older clients.
 *
 * Body carries a `project` field so the mutation targets the right repo.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  const issueNumber = Number(number);
  if (!Number.isInteger(issueNumber)) {
    return NextResponse.json({ error: "Bad issue number" }, { status: 400 });
  }

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let repo: RepoConfig;
  try {
    ({ repo } = await resolveProject(body.project));
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }

  const action = body.action === "reject" ? "decline" : body.action;
  const text = (body.text ?? "").trim();

  if (action === "redraft" && !text) {
    return NextResponse.json(
      { error: "Feedback is required to send an idea back." },
      { status: 400 },
    );
  }
  if (!["approve", "unapprove", "redraft", "decline"].includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const current = (await getIssue(issueNumber, repo)).labels;

    switch (action) {
      case "approve": {
        if (text) await createComment(issueNumber, text, repo);
        await setIssueLabels(issueNumber, nextLabels(current, "approved"), repo);
        const dispatched = await wake(
          "claude-builder.yml",
          repo,
          current.includes("approved"),
        );
        return NextResponse.json({ ok: true, dispatched });
      }
      case "unapprove": {
        await setIssueLabels(issueNumber, nextLabels(current, "proposal"), repo);
        return NextResponse.json({ ok: true });
      }
      case "redraft": {
        await createComment(
          issueNumber,
          `**Owner feedback for redraft:**\n\n${text}`,
          repo,
        );
        await setIssueLabels(issueNumber, nextLabels(current, "redraft"), repo);
        const dispatched = await wake(
          "claude-redraft.yml",
          repo,
          current.includes("redraft"),
          { issue_number: String(issueNumber) },
        );
        return NextResponse.json({ ok: true, dispatched });
      }
      case "decline": {
        if (text) {
          await createComment(issueNumber, `**Declined by the owner:**\n\n${text}`, repo);
        }
        await setIssueLabels(issueNumber, nextLabels(current, "declined"), repo);
        await closeIssue(issueNumber, "not_planned", repo);
        return NextResponse.json({ ok: true });
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 502 });
  }
}

function msg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "GitHub request failed. Try again in a moment.";
}
