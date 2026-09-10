/**
 * The product brief — the file every agent in a target repo's loop reads
 * before doing anything.
 *
 * Why this exists: the brief ships as a template full of `_Not filled in
 * yet._` placeholders. Every agent workflow checks for that literal string
 * before it acts, and if it's still there the agent stands down cleanly and
 * logs a warning nobody watches for. A repo can sit like that indefinitely —
 * it did, for two days, on the pilot project — with no signal anywhere in
 * this dashboard that anything was wrong. This module is what lets the
 * dashboard notice.
 *
 * Two things it has to get right:
 *   1. WHERE the brief lives. The template installs it at `docs/loop-brief.md`
 *      (see `TEMPLATE_FILE_TARGETS` in lib/loop-template.ts), but at least one
 *      live repo relocated it to `docs/archive/loop-brief.md` and its
 *      workflows read it from there. Both are real; {@link resolveBriefPath}
 *      asks GitHub rather than assuming either one.
 *   2. WHETHER it's actually filled in. {@link analyseBrief} is a pure
 *      function over the markdown text so it can be tested without touching
 *      GitHub, and so the route and any future UI can share one answer for
 *      "is this section still blank".
 */

import { getFileContent, type RepoConfig } from "./github";
import { TEMPLATE_FILE_TARGETS } from "./loop-template";

/** The literal placeholder every section of a freshly-installed brief carries. */
export const BRIEF_PLACEHOLDER = "_Not filled in yet._";

/** Where the template installs the brief in a newly onboarded repo. */
export const TEMPLATE_BRIEF_PATH = TEMPLATE_FILE_TARGETS["loop-brief.md"];

/** The relocated path at least one live repo's workflows read the brief from. */
export const ARCHIVE_BRIEF_PATH = "docs/archive/loop-brief.md";

/**
 * Find which of the two legitimate brief paths actually exists in `repo`.
 *
 * Checks both — not "archive, and only template if archive 404s" — because
 * telling the caller "both exist" requires having looked at both. When both
 * are present the archive path wins (that's the one a relocated repo's
 * workflows are actually reading), and we log so the split is visible instead
 * of silently picked. When neither exists, returns `null`; callers decide
 * what "no brief yet" means for them. Never creates anything and never
 * guesses — a wrong guess here would read (or write) the wrong file.
 */
export async function resolveBriefPath(repo: RepoConfig): Promise<string | null> {
  const [archive, template] = await Promise.all([
    getFileContent(ARCHIVE_BRIEF_PATH, undefined, repo),
    getFileContent(TEMPLATE_BRIEF_PATH, undefined, repo),
  ]);

  if (archive !== null && template !== null) {
    console.warn(
      `brief: ${repo.owner}/${repo.repo} has a brief at both ${ARCHIVE_BRIEF_PATH} and ` +
        `${TEMPLATE_BRIEF_PATH} — reading ${ARCHIVE_BRIEF_PATH}, which the relocated ` +
        "workflow convention reads from.",
    );
  }
  if (archive !== null) return ARCHIVE_BRIEF_PATH;
  if (template !== null) return TEMPLATE_BRIEF_PATH;
  return null;
}

export type BriefAnalysis = {
  /** True only when no section still carries the placeholder AND the brief is non-trivial. */
  filled: boolean;
  /** Real heading text of every section that still contains the placeholder. */
  unfilledSections: string[];
  /** How many headings (any level) the brief has. */
  totalSections: number;
};

/** Matches a markdown ATX heading of any level (`#` through `######`). */
const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/;

/**
 * Parse the brief's markdown and report which sections are still blank.
 *
 * Deliberately does not hardcode `##` — the template happens to use `##` for
 * its four content sections, but a repo's brief is a hand-edited file and
 * nothing stops someone reformatting a heading to `###` (or, for a wrapper
 * section like the template's "Keeping this current", starting at a
 * different level entirely). A section's body is "everything between this
 * heading and the next heading of ANY level, or end of file" — which is also
 * what makes the last section's placeholder detectable even though nothing
 * follows it.
 *
 * `filled` requires BOTH zero sections containing the placeholder AND the
 * content being non-trivial, so an empty (or whitespace-only) file — which
 * has no headings and so trivially contains no placeholder — still reads as
 * not filled in rather than as vacuously done.
 */
export function analyseBrief(content: string): BriefAnalysis {
  if (content.trim() === "") {
    return { filled: false, unfilledSections: [], totalSections: 0 };
  }

  const lines = content.split("\n");
  const headings: { text: string; lineIndex: number }[] = [];
  lines.forEach((line, lineIndex) => {
    const match = line.match(HEADING_RE);
    if (match) headings.push({ text: match[1].trim(), lineIndex });
  });

  // No headings at all: there's nothing to name, but a raw file that still
  // contains the placeholder text is obviously not filled in either.
  if (headings.length === 0) {
    const filled = !content.includes(BRIEF_PLACEHOLDER);
    return { filled, unfilledSections: [], totalSections: 0 };
  }

  const unfilledSections: string[] = [];
  headings.forEach((heading, i) => {
    const bodyStart = heading.lineIndex + 1;
    const bodyEnd = i + 1 < headings.length ? headings[i + 1].lineIndex : lines.length;
    const body = lines.slice(bodyStart, bodyEnd).join("\n");
    if (body.includes(BRIEF_PLACEHOLDER)) unfilledSections.push(heading.text);
  });

  return {
    filled: unfilledSections.length === 0,
    unfilledSections,
    totalSections: headings.length,
  };
}
