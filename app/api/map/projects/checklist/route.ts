import { NextResponse } from "next/server";
import { getOctokit, getFileContent } from "@/lib/github";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import { analyseBrief, resolveBriefPath } from "@/lib/brief";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/projects/checklist?project=<key>
 *
 * The three conditions that decide whether a freshly-installed loop will
 * actually do anything. None of them are visible in the commit that installs
 * it, and all three fail silently, which is the whole reason this endpoint
 * exists:
 *
 *  - brief:  the product brief every agent reads first. While it still holds
 *            its placeholder text the agents stand down on every scheduled
 *            run — cleanly, with a warning nobody reads. Until this endpoint
 *            reported it, a loop could sit dead for days looking healthy.
 *  - secret: CLAUDE_CODE_OAUTH_TOKEN. true/false when the token can be checked
 *            (names only, never values), null when our token can't look.
 *  - app:    always "unknown" — a fine-grained PAT cannot list GitHub App
 *            installations (verified), so we give instructions instead; the
 *            real proof is the first agent run.
 *
 * A check that could not run reports null/"unknown" and must never be rendered
 * as a pass. Not knowing is its own answer.
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);

    // Both checks hit GitHub and neither depends on the other, so pay for one
    // round trip rather than two.
    const [briefResult, secretResult] = await Promise.allSettled([
      readBriefStatus(repo),
      readSecretPresence(repo),
    ]);

    const brief = briefResult.status === "fulfilled" ? briefResult.value : null;
    const secret = secretResult.status === "fulfilled" ? secretResult.value : null;

    if (briefResult.status === "rejected") {
      console.warn("checklist: brief read failed", briefResult.reason);
    }

    return NextResponse.json({
      brief,
      secret,
      secretHelp:
        `Secrets can't be copied between repos. If you'd rather not paste it here: gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${repo.owner}/${repo.repo} — or add it by hand on GitHub under Settings → Secrets and variables → Actions.`,
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

/**
 * Whether the brief exists and is actually written, plus the names of the
 * sections still holding placeholder text so the UI can say which ones.
 */
async function readBriefStatus(repo: { owner: string; repo: string }) {
  const path = await resolveBriefPath(repo);
  if (path === null) {
    return { path: null, exists: false, filled: false, unfilledSections: [] };
  }
  const content = await getFileContent(path, undefined, repo);
  if (content === null) {
    // resolveBriefPath said it was there and the read disagreed. Report it as
    // missing rather than guessing — an unproven pass is the thing we're
    // trying to eliminate.
    return { path, exists: false, filled: false, unfilledSections: [] };
  }
  const { filled, unfilledSections } = analyseBrief(content);
  return { path, exists: true, filled, unfilledSections };
}

/** Secret *names* only — the API never exposes values, and neither do we. */
async function readSecretPresence(repo: { owner: string; repo: string }): Promise<boolean | null> {
  try {
    const res = await getOctokit().rest.actions.listRepoSecrets({
      owner: repo.owner,
      repo: repo.repo,
      per_page: 100,
    });
    return res.data.secrets.some((s) => s.name === "CLAUDE_CODE_OAUTH_TOKEN");
  } catch (err) {
    console.warn("checklist: secrets read failed", err);
    return null; // token can't read secrets — show instructions instead
  }
}
