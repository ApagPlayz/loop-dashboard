import { NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/projects/checklist?project=<key>
 * Setup verification for a project:
 *  - secret: true/false when the CLAUDE_CODE_OAUTH_TOKEN secret can be checked
 *    (names only), null when the token lacks permission to look.
 *  - app: always "unknown" — a fine-grained PAT cannot list GitHub App
 *    installations (verified), so we give instructions instead; the real
 *    proof is the first agent run.
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);

    let secret: boolean | null = null;
    try {
      const res = await getOctokit().rest.actions.listRepoSecrets({
        owner: repo.owner,
        repo: repo.repo,
        per_page: 100,
      });
      secret = res.data.secrets.some((s) => s.name === "CLAUDE_CODE_OAUTH_TOKEN");
    } catch (err) {
      console.warn("checklist: secrets read failed", err);
      secret = null; // token can't read secrets — show instructions instead
    }

    return NextResponse.json({
      secret,
      secretHelp:
        `Secrets can't be copied between repos. In a terminal: gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${repo.owner}/${repo.repo} — or paste the token by hand on GitHub under Settings → Secrets and variables → Actions.`,
      app: {
        status: "unknown",
        note:
          "The dashboard can't check GitHub App installs with its token. Make sure the Claude GitHub app covers this repo — it takes one minute — and the first agent run will prove it either way.",
        url: "https://github.com/apps/claude",
      },
    });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("checklist: failed", err);
    return NextResponse.json(
      { error: "Couldn't run the setup checks. Try again." },
      { status: 502 },
    );
  }
}
