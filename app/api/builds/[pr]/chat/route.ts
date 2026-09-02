import { NextResponse } from "next/server";
import {
  aiChatCall,
  assistantAvailable,
  assistantCanReadCode,
  AiError,
  type ChatMessage,
} from "@/lib/map-ai";
import { loadPRDetail, isBuilderBranch } from "@/lib/queues";
import { getOctokit, type RepoConfig } from "@/lib/github";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import { localCheckoutForRepo } from "@/lib/local-folders";
import {
  READONLY_TOOLS,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
  defuse,
  filesystemBoundary,
  untrustedPreamble,
} from "@/lib/prompt-safety";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHAT_TIMEOUT_MS = 60_000;
/** Longer budget when the assistant is actually reading code (multi-turn). */
const CODE_CHAT_TIMEOUT_MS = 150_000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;
/** How much of the PR's diff to include in the prompt before truncating. */
const MAX_DIFF_CHARS = 14_000;

/**
 * POST /api/builds/[pr]/chat
 * Body: { messages: { role: "user" | "assistant"; content: string }[] }
 * Returns: { reply: string }
 *
 * A private, local chat about ONE pull request — never posted to GitHub. It is
 * given the PR's title/body/verdict/thread AND its actual diff, and — when the
 * project is checked out locally AND the CLI backend is the one serving the
 * call — read-only tools (Read/Grep/Glob) rooted at that checkout so it can
 * verify how the changed code fits the wider codebase instead of guessing.
 * Falls back to diff+text-only otherwise, including on the hosted backends,
 * which ignore `cwd`/`tools` entirely.
 *
 * Two things keep that tool grant safe, and both are load-bearing:
 *   - only PRs the Builds queue actually surfaces for this project can be
 *     addressed (see the queue gate below), so a caller can't point the agent
 *     at an arbitrary outside contributor's PR; and
 *   - everything GitHub hands back — title, body, branch names, verdict, diff,
 *     comments — is third-party text, so it is `defuse()`d and fenced as DATA,
 *     and the prompt states the filesystem boundary the tools do not enforce.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ pr: string }> },
) {
  if (!assistantAvailable()) {
    return NextResponse.json(
      { error: "AI chat needs an AI backend (local Claude app, AWS Bedrock, or an Anthropic API key)." },
      { status: 503 },
    );
  }

  const { pr } = await params;
  const prNumber = Number(pr);
  // GitHub numbers PRs from 1 — zero and negatives are malformed, not lookups.
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return NextResponse.json({ error: "Bad PR number" }, { status: 400 });
  }

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const raw = Array.isArray(body.messages) ? body.messages : null;
  if (!raw || raw.length === 0) {
    return NextResponse.json({ error: "Send at least one message." }, { status: 400 });
  }
  if (raw.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: "This chat is getting long — start a fresh one." },
      { status: 400 },
    );
  }

  const messages: ChatMessage[] = [];
  for (const item of raw) {
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    const text = content.trim();
    if (!text) continue;
    if (text.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        { error: "That message is too long — please shorten it." },
        { status: 400 },
      );
    }
    messages.push({ role, content: text });
  }

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }

  try {
    const { repo: repoConfig } = await resolveProjectFromUrl(req.url);
    const { owner, repo } = repoConfig;
    const [detail, checkout] = await Promise.all([
      loadPRDetail(prNumber, repoConfig),
      localCheckoutForRepo(owner, repo),
    ]);

    // QUEUE GATE — the analogue of the ideas route's label allowlist.
    //
    // `loadPRDetail` is scoped to the resolved project, so the number can't
    // reach another repo, but ANY pull request number in that repo used to be
    // addressable — including an open PR pushed by an outside contributor,
    // whose title, body and diff are entirely attacker-written and which this
    // route then feeds to a tool-enabled agent. The Builds screen only ever
    // surfaces two kinds of PR, so those are the only two we accept:
    //   - open PRs on a Builder branch (`claude/…`), the "needs review" tab; and
    //   - closed/merged PRs, the Merged and Closed tabs.
    // Anything else is not part of this project's build queue and is refused
    // before its text is fetched or interpolated into a prompt.
    const inBuildQueue = detail.state === "closed" || isBuilderBranch(detail.headRef);
    if (!inBuildQueue) {
      return NextResponse.json(
        { error: "That pull request isn't in this project's build queue." },
        { status: 404 },
      );
    }

    // Fetched only after the gate, so a PR we won't discuss never has its diff
    // pulled down in the first place.
    const diff = await loadDiff(prNumber, repoConfig);

    const discussion = detail.comments.length
      ? detail.comments.map((c) => `${defuse(c.author)}: ${defuse(c.body)}`).join("\n\n")
      : "(no discussion yet)";

    const verdictLine = detail.verdict
      ? `Auditor verdict: ${defuse(detail.verdict.verdict)}`
      : "Auditor verdict: none yet";

    // Only the CLI backend can actually run the read-only tools against a
    // checkout; the hosted backends (Bedrock / Anthropic API) silently ignore
    // `cwd`/`tools` and answer from the diff alone, so don't promise them tools
    // they won't have — a model told it can read code it can't will invent
    // file paths and cite them. `assistantCanReadCode()` is `aiBackend() ===
    // "cli"`, deterministic and settled before the call.
    const canReadCode = checkout !== null && assistantCanReadCode();

    const codeAccess = canReadCode && checkout
      ? `You CAN read this project's ACTUAL source code: it is checked out locally at ${checkout} (on its \`${defuse(detail.baseRef)}\` branch) and you have read-only tools (Read, Grep, Glob) whose working directory is that checkout. USE THEM together with the diff below. The diff is the source of truth for what THIS PR changes; the local checkout is the surrounding code as it currently stands. Before making ANY claim about what the PR does, whether it's correct, or how it interacts with the rest of the app, read the real files and cite the specific paths. Never assert behaviour from the PR's description alone — descriptions can be wrong or aspirational. If you can't verify something, say so instead of guessing.

${filesystemBoundary(checkout)}`
      : `You are NOT connected to this project's code on this machine (its local checkout isn't available here, or this backend can't run tools); you only have the PR's diff and text below, no tools. Reason from the diff — it is the source of truth for what changed. If a question needs wider codebase context you don't have, say so plainly instead of guessing — do NOT state how the surrounding code behaves as if you had checked it, and do NOT cite file paths as though you had opened them.`;

    const system = `You are a thinking-partner for the owner of ${owner}/${repo}, helping them review ONE pull request before they decide whether to merge it, send it back for changes, or close it. This is a private conversation — nothing you say here is posted to GitHub.

${codeAccess}

${untrustedPreamble(
  "the Builder agent, the Auditor agent, bots, and anyone who can open a pull request or comment on one",
)}

${UNTRUSTED_OPEN}
THE PULL REQUEST — #${detail.number}, "${defuse(detail.title)}" (branch ${defuse(detail.headRef)} → ${defuse(detail.baseRef)}):
${defuse(detail.body?.trim() || "") || "(no description)"}

${verdictLine}. Changes: +${detail.additions}/−${detail.deletions} across ${detail.changedFiles} file(s).

THE DIFF:
${defuse(diff)}

DISCUSSION SO FAR:
${discussion}
${UNTRUSTED_CLOSE}

Answer the owner's questions plainly and honestly — be direct about correctness, risk, scope, and whether this PR is safe to merge. You're here to help them decide, not to cheerlead.`;

    const reply = await aiChatCall({
      system,
      messages,
      timeoutMs: canReadCode ? CODE_CHAT_TIMEOUT_MS : CHAT_TIMEOUT_MS,
      cwd: canReadCode ? (checkout ?? undefined) : undefined,
      tools: canReadCode ? READONLY_TOOLS : undefined,
    });
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("PR chat: failed", err);
    return NextResponse.json({ error: "Couldn't reach Claude. Try again." }, { status: 502 });
  }
}

/**
 * The PR's diff as a single string (per-file patches concatenated), truncated
 * to a sane budget. Best-effort — returns a placeholder on any failure so the
 * chat still works from the code checkout + text.
 */
async function loadDiff(
  prNumber: number,
  repoConfig: RepoConfig,
): Promise<string> {
  const { owner, repo } = repoConfig;
  try {
    const files = await getOctokit().paginate(getOctokit().rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    let out = "";
    for (const f of files) {
      const header = `\n--- ${f.filename} (${f.status}, +${f.additions}/−${f.deletions}) ---\n`;
      const patch = f.patch ? f.patch : "(binary or no textual diff)";
      if (out.length + header.length + patch.length > MAX_DIFF_CHARS) {
        out += `\n… diff truncated (${files.length} files total; read the checkout for the rest) …\n`;
        break;
      }
      out += header + patch + "\n";
    }
    return out.trim() || "(no textual diff)";
  } catch (err) {
    console.error("PR chat: diff load failed", err);
    return "(couldn't load the diff; rely on the code checkout and PR text)";
  }
}
