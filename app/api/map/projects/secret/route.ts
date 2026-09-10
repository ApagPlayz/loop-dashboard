import { NextResponse } from "next/server";

import { ProjectError, resolveProject } from "@/lib/projects";
import {
  CLAUDE_OAUTH_SECRET_NAME,
  setRepoSecret,
  validateOAuthToken,
  verifyOAuthTokenLive,
} from "@/lib/repo-secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/map/projects/secret
 *
 * Write the CLAUDE_CODE_OAUTH_TOKEN Actions secret onto a project's repo, so
 * setting up a new project never requires a terminal and a `gh secret set`.
 * The setup checklist (GET .../checklist) reads the same secret back.
 *
 * Body: { project: string, token: string, skipVerify?: boolean }
 * Returns: { ok: true, verified: boolean }  — never the token, in any form.
 *
 * The order below is the whole point of the route, so it is spelled out:
 *
 *   1. shape-check locally   → 400. Free, and catches the truncated-paste bug
 *                              that this feature exists because of.
 *   2. ask Anthropic         → 422 when Anthropic says no.
 *   3. write to GitHub       → 502 when the write fails.
 *
 * A token that Anthropic rejected is NEVER written. A stored-but-broken token
 * is strictly worse than no token at all: the checklist goes green, the owner
 * moves on, and the failure surfaces days later as an unexplained auth error
 * inside a workflow run. If we could not reach Anthropic at all we stop too
 * (502) — but we say so plainly and offer `skipVerify`, because "our check is
 * down" must not become "you cannot finish setting up".
 */
export async function POST(req: Request) {
  let body: { project?: unknown; token?: unknown; skipVerify?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const projectKey = typeof body.project === "string" ? body.project : "";
  // Trim once, here, and use the trimmed value for every later step — checking
  // one string and storing a different one is how a stray trailing newline
  // ends up inside the secret.
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const skipVerify = body.skipVerify === true;

  const shape = validateOAuthToken(token);
  if (!shape.ok) {
    return NextResponse.json({ error: shape.reason }, { status: 400 });
  }

  try {
    // Same helper the checklist route resolves through, so an unknown or
    // missing project key produces the identical error and status there and
    // here.
    const { repo } = await resolveProject(projectKey);

    let verified = false;
    if (!skipVerify) {
      const live = await verifyOAuthTokenLive(token);
      if (!live.ok && live.inconclusive) {
        // Deliberately NOT a write. We don't know that the token is bad, but
        // we don't know that it is good either, and this is the one place
        // where guessing costs the owner a debugging session.
        return NextResponse.json(
          {
            error:
              `${live.detail} You can save it without checking if you're sure it's ` +
              "right — send the same request again with skipVerify.",
            verified: false,
          },
          { status: 502 },
        );
      }
      if (!live.ok) {
        return NextResponse.json({ error: live.detail }, { status: 422 });
      }
      verified = true;
    }

    await setRepoSecret(repo, CLAUDE_OAUTH_SECRET_NAME, token);

    return NextResponse.json({ ok: true, verified });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    // The error is logged, not returned: an Octokit failure carries the whole
    // request it tried to make. The ciphertext in there is not the token, but
    // nothing from this request belongs in a browser either way.
    console.error("projects/secret: write failed", err);
    return NextResponse.json(
      {
        error:
          "Couldn't save the token on GitHub. Check that the repo still exists and that " +
          "the dashboard's GitHub token can write its Actions secrets, then try again.",
      },
      { status: 502 },
    );
  }
}
