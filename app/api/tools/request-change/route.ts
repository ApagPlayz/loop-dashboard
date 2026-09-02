import { NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import { resolveProject, ProjectError } from "@/lib/projects";
import {
  MAX_RELAYED_CHARS,
  relayedBlock,
  sanitizeRelayedText,
} from "@/lib/relay-safety";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How much of the request to echo into the issue title. */
const TITLE_CHARS = 60;

/**
 * Who wrote the fenced text, as told to the agent that reads it. The issue is
 * filed by the dashboard's GitHub token, so its author field says "admin" and
 * proves nothing about who typed the words.
 */
const RELAY_AUTHORS =
  "whoever typed into the dashboard's Tools page — this issue was filed by the dashboard's own GitHub token, which does NOT authenticate the person behind it";

/**
 * Ask Claude to change or remove a shared tool. Opens a plain (unlabeled) issue
 * whose body starts with "@claude" so the mention agent picks it up.
 * Body: { project: string, request: string }.
 *
 * `project` is required — the issue is filed in that project's repo. It used
 * to always land on the pilot regardless of the switcher.
 *
 * SECURITY — why the request text is sanitized and fenced.
 * This route exists to wake the mention agent, and the target repo's mention
 * workflow gates on the COMMENT/ISSUE AUTHOR's repository permission
 * (admin|maintain only). The author is this dashboard's own GitHub token,
 * which is an admin — so that gate passes automatically for anything we file,
 * and the caller's words land in a CI job holding `contents: write`,
 * `issues: write`, `actions: write` and Bash. The repo's own authorization
 * control is inverted into an amplifier. Session auth on this route (proxy.ts)
 * is the first defence; this is the second, for a guessed password or a future
 * read-only/demo deployment. The caller's text is length-capped, has its
 * @-mentions defanged, and is fenced as data in the body using the repo's
 * UNTRUSTED_OPEN/UNTRUSTED_CLOSE convention. The TITLE is derived from the
 * same sanitized string — it can't be fenced (it's one line of metadata), but
 * it therefore can't carry a live mention either. The only "@claude" that
 * still works is ours, outside the fence.
 */
export async function POST(req: Request) {
  let body: { project?: string; request?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const clean = sanitizeRelayedText(body.request, {
    emptyError: "Describe what you'd like changed.",
    longError: `That's too long — keep the request under ${MAX_RELAYED_CHARS} characters.`,
  });
  if (!clean.ok) {
    return NextResponse.json({ error: clean.error }, { status: 400 });
  }
  const request = clean.text;

  // The title is a single line: newlines in it would let caller text sprawl into
  // what looks like separate metadata in every list that renders the issue.
  const summary = request.replace(/\s+/g, " ").slice(0, TITLE_CHARS);
  const title = `Tool change request: ${summary}${request.length > TITLE_CHARS ? "…" : ""}`;

  try {
    const { repo } = await resolveProject(body.project);
    const res = await getOctokit().rest.issues.create({
      owner: repo.owner,
      repo: repo.repo,
      title,
      body: `@claude — a shared-tool change was requested from the dashboard.\n\n${relayedBlock(request, RELAY_AUTHORS)}`,
    });
    return NextResponse.json({ ok: true, url: res.data.html_url });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json(
      { error: "Could not send the request. Please try again." },
      { status: 500 },
    );
  }
}
