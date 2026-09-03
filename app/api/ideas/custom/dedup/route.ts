import { NextResponse } from "next/server";
import { resolveProject, ProjectError } from "@/lib/projects";
import { inferDraftDuplicates } from "@/lib/dedup/infer-client";
import { INDEX_REPO } from "@/lib/dedup/queue-duplicates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/ideas/custom/dedup
 *
 * "Has this already been proposed?" for a draft the owner has not filed yet.
 *
 * ## Why this route exists and the Ideas screen has no equivalent
 *
 * `lib/dedup/queue-duplicates.ts` scores the Ideas queue in-process, because
 * every issue on that screen already has a vector in the embedding index. A
 * draft in the composer does not — it has never been embedded — so the only
 * way to score it is to embed it, which costs a Bedrock call. That is what the
 * deployed Lambda (`infra/lambda-dedup-infer/`) does, and this route is the
 * one thing in the product that calls it. See `lib/dedup/infer-client.ts` for
 * why it goes through the Function URL rather than calling Bedrock directly.
 *
 * ## Auth
 *
 * No auth code here, deliberately — the same as the other 60-odd owner-only
 * routes. `proxy.ts` is the single gate (see `lib/public-access.ts`): a route
 * with no `ALWAYS_PUBLIC_API` entry and no demo fixture is unreachable for an
 * anonymous caller, which this one has neither of. Because it spends money on
 * Bedrock it is also named in `tests/lib/public-access.test.ts`'s `llmRoutes`
 * list, which pins "anonymous callers cannot reach it" as an assertion rather
 * than an assumption.
 *
 * ## Contract
 *
 *   Request  { project?: string, title?: string, body?: string }
 *   Response 200 { available: true, matches, duplicate, threshold, … }
 *            200 { available: false, reason }   ← everything went wrong quietly
 *            400 { available: false, reason }   ← the request itself was bad
 *
 * A failed check is a 200 with `available: false`, not a 5xx. The composer must
 * never treat "I couldn't check for duplicates" as "your idea failed" — this is
 * decoration on a draft, and the owner has to be able to file regardless.
 */

/** The shortest draft worth spending a Bedrock call on. */
const MIN_CHARS = 20;

type Body = { project?: string; title?: string; body?: string };

/**
 * A GitHub URL for a matched corpus document.
 *
 * `queue-duplicates.ts` refuses to construct these, and is right to: it carries
 * `htmlUrl` through from the live queue precisely because a hard-coded
 * owner/repo is "the one place a constructed URL could quietly point at the
 * wrong repository". That risk is closed here a different way — the handler has
 * already refused to run unless the resolved project IS `INDEX_REPO`, so there
 * is exactly one repository these numbers can belong to. `/issues/<n>` is used
 * for pull requests too; GitHub redirects it to `/pull/<n>`.
 */
function matchUrl(number: number): string {
  return `https://github.com/${INDEX_REPO.owner}/${INDEX_REPO.repo}/issues/${number}`;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ available: false, reason: "Bad request." }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const draft = (body.body ?? "").trim();
  if ((title + draft).length < MIN_CHARS) {
    return NextResponse.json(
      { available: false, reason: "Write a bit more of the idea first." },
      { status: 400 },
    );
  }

  let resolved;
  try {
    resolved = await resolveProject(body.project);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ available: false, reason: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
  const { repo } = resolved;

  // The corpus, and therefore the index the Lambda scores against, describes
  // exactly one repository. Checking a draft for another project would embed
  // it (real money) and then compare it against issues from a repo it has
  // nothing to do with, reporting confident nonsense. Refuse before spending.
  if (repo.owner !== INDEX_REPO.owner || repo.repo !== INDEX_REPO.repo) {
    return NextResponse.json({
      available: false,
      reason:
        `Duplicate checking only covers ${INDEX_REPO.owner}/${INDEX_REPO.repo} — ` +
        "that is the only repository the embedding index was built from.",
    });
  }

  const result = await inferDraftDuplicates({ title, body: draft });
  if (!result.available) return NextResponse.json(result);

  return NextResponse.json({
    ...result,
    matches: result.matches.map((m) => ({ ...m, htmlUrl: matchUrl(m.number) })),
  });
}
