/**
 * The staleness DECISION logic — audit finding C4's tier 1.
 *
 * Nothing here touches GitHub. Every function under test is pure: it takes the
 * facts (an event log, a list of commits, a timestamp) and returns a verdict.
 * That split is the point — the parts that call Octokit are thin wrappers, and
 * the part that decides whether to put a `stale` label on the owner's issue is
 * the part that has to be right.
 *
 * The cases that matter most are the ones about being WRONG:
 *   - the approval date is often not knowable, and the fallbacks are wrong in
 *     opposite directions. Which one we used has to be visible, not hidden;
 *   - a loop commit misread as a human commit is a false flag;
 *   - an idea that cites no file paths must not be silently un-flaggable.
 */

import { describe, expect, it } from "vitest";

import {
  MIN_HUMAN_COMMITS,
  VOLUME_ONLY_THRESHOLD,
  evaluateTier1,
  extractCitedPaths,
  isLoopCommitAuthor,
  isStaleCheckDue,
  pathsRelated,
  resolveApprovedAt,
  type CommitEvidence,
} from "../../lib/idea-staleness";

const APPROVED = "2026-08-12T10:00:00Z";

function commit(over: Partial<CommitEvidence> = {}): CommitEvidence {
  return {
    sha: "abc1234def",
    shortSha: "abc1234",
    committedAt: "2026-08-14T09:00:00Z",
    author: "Alessio",
    isHuman: true,
    subject: "tighten the session check",
    files: ["lib/auth/session.ts"],
    ...over,
  };
}

const APPROVED_AT = {
  at: APPROVED,
  source: "label-event" as const,
  precise: true,
  caveat: "",
};

/* ------------------------------------------------------------------ */
/* Approved-at resolution                                              */
/* ------------------------------------------------------------------ */

describe("resolveApprovedAt", () => {
  const idea = {
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
  };

  it("uses the `labeled: approved` event and reports it as precise", () => {
    const got = resolveApprovedAt(
      [
        { event: "labeled", label: "proposal", createdAt: "2026-08-01T00:00:00Z" },
        { event: "labeled", label: "approved", createdAt: APPROVED },
        { event: "commented", label: null, createdAt: "2026-08-15T00:00:00Z" },
      ],
      idea,
    );
    expect(got).toMatchObject({ at: APPROVED, source: "label-event", precise: true });
    expect(got.caveat).toBe("");
  });

  it("takes the LATEST approval, not the first", () => {
    // Approved, un-approved after a rethink, approved again a month later. The
    // first date would count a month of unrelated commits against the idea.
    const got = resolveApprovedAt(
      [
        { event: "labeled", label: "approved", createdAt: "2026-07-01T00:00:00Z" },
        { event: "unlabeled", label: "approved", createdAt: "2026-07-05T00:00:00Z" },
        { event: "labeled", label: "approved", createdAt: APPROVED },
      ],
      idea,
    );
    expect(got.at).toBe(APPROVED);
  });

  it("ignores label events for other labels", () => {
    const got = resolveApprovedAt(
      [{ event: "labeled", label: "redraft", createdAt: "2026-08-05T00:00:00Z" }],
      idea,
    );
    expect(got.source).toBe("updated-at");
  });

  it("falls back to updatedAt, flags it as imprecise, and says why", () => {
    const got = resolveApprovedAt([], idea);
    expect(got.at).toBe(idea.updatedAt);
    expect(got.source).toBe("updated-at");
    expect(got.precise).toBe(false);
    // The caveat has to state the DIRECTION of the error, not just that there
    // is one: this window is too short, so the check under-flags.
    expect(got.caveat).toMatch(/too FEW commits/);
  });

  it("falls back to createdAt only when updatedAt is unusable", () => {
    const got = resolveApprovedAt([], { createdAt: idea.createdAt, updatedAt: "" });
    expect(got.at).toBe(idea.createdAt);
    expect(got.source).toBe("created-at");
    expect(got.precise).toBe(false);
    expect(got.caveat).toMatch(/too WIDE/);
  });

  it("ignores a label event with an unparseable timestamp", () => {
    const got = resolveApprovedAt(
      [{ event: "labeled", label: "approved", createdAt: "not a date" }],
      idea,
    );
    expect(got.source).toBe("updated-at");
  });
});

/* ------------------------------------------------------------------ */
/* The interval gate                                                   */
/* ------------------------------------------------------------------ */

describe("isStaleCheckDue", () => {
  const now = new Date("2026-09-07T12:00:00Z");

  it("is due when nothing has ever run", () => {
    const got = isStaleCheckDue(null, 24, now);
    expect(got.due).toBe(true);
    expect(got.hoursSince).toBeNull();
  });

  it("is not due inside the interval, and says when it next will be", () => {
    const got = isStaleCheckDue("2026-09-07T06:00:00Z", 24, now);
    expect(got.due).toBe(false);
    expect(Math.round(got.hoursSince ?? 0)).toBe(6);
    expect(got.nextDueAt).toBe("2026-09-08T06:00:00.000Z");
  });

  it("is due exactly on the boundary", () => {
    // The Scout cron fires on the hour, so "23.99h since" and "24.01h since"
    // are the same run in practice. Off-by-one here means an every-24h check
    // silently becomes every-48h.
    expect(isStaleCheckDue("2026-09-06T12:00:00Z", 24, now).due).toBe(true);
  });

  it("respects a shorter interval", () => {
    expect(isStaleCheckDue("2026-09-07T11:00:00Z", 6, now).due).toBe(false);
    expect(isStaleCheckDue("2026-09-07T05:00:00Z", 6, now).due).toBe(true);
    expect(isStaleCheckDue("2026-09-07T10:30:00Z", 1, now).due).toBe(true);
  });

  it("treats a nonsense interval as one hour rather than dividing by zero", () => {
    expect(isStaleCheckDue("2026-09-07T11:30:00Z", 0, now).due).toBe(false);
    expect(isStaleCheckDue("2026-09-07T10:30:00Z", 0, now).due).toBe(true);
  });

  it("ignores a last-checked stamp dated in the future", () => {
    // One bad clock must not wedge the feature off until that date passes.
    const got = isStaleCheckDue("2027-01-01T00:00:00Z", 24, now);
    expect(got.due).toBe(true);
    expect(got.reason).toMatch(/future/);
  });

  it("treats an unparseable stamp as never checked", () => {
    expect(isStaleCheckDue("whenever", 24, now).due).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Author classification                                               */
/* ------------------------------------------------------------------ */

describe("isLoopCommitAuthor", () => {
  it("matches the four patterns the Scout's git-log awk uses", () => {
    expect(isLoopCommitAuthor("claude[bot]", "noreply@anthropic.com")).toBe(true);
    expect(isLoopCommitAuthor("github-actions[bot]", "actions@github.com")).toBe(true);
    expect(isLoopCommitAuthor("Some Bot", "x@y.z", "someone[bot]")).toBe(true);
    expect(isLoopCommitAuthor("Anthropic CI", "ci@example.com")).toBe(true);
  });

  it("treats a person as a person", () => {
    expect(isLoopCommitAuthor("Alessio Pagliarulo", "alessiopag2005@gmail.com")).toBe(
      false,
    );
  });

  it("is case-insensitive", () => {
    expect(isLoopCommitAuthor("GitHub-Actions[Bot]", "")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Path extraction and matching                                        */
/* ------------------------------------------------------------------ */

describe("extractCitedPaths", () => {
  it("pulls a path:line citation out of prose and drops the line number", () => {
    expect(
      extractCitedPaths("The bug is at `lib/queues.ts:598` — see it yourself."),
    ).toEqual(["lib/queues.ts"]);
  });

  it("does not mistake a URL's path for a repo path", () => {
    // The regression this guards: the scheme has no path characters, so a
    // naive "drop things starting with http" filter never sees it and
    // "example.com/blog/post" gets treated as a file in the repo. Ideas cite
    // external sources constantly — the Scout's evidence floor asks for them.
    expect(
      extractCitedPaths("Per https://example.com/blog/2026/post we should fix this."),
    ).toEqual([]);
  });

  it("keeps a bare directory, normalised without its trailing slash", () => {
    expect(extractCitedPaths("Everything under src/auth/ is affected.")).toEqual([
      "src/auth",
    ]);
  });

  it("ignores a bare filename with no slash", () => {
    // "package.json" is a real citation and also a phrase in half of all prose
    // about software. Requiring a slash costs a few true matches and removes
    // most of the false ones.
    expect(extractCitedPaths("Bump the dep in package.json.")).toEqual([]);
  });

  it("ignores dependency paths", () => {
    expect(extractCitedPaths("It breaks in node_modules/foo/index.js")).toEqual([]);
  });

  it("de-duplicates", () => {
    expect(
      extractCitedPaths("lib/a.ts is wrong, and lib/a.ts:12 is where."),
    ).toEqual(["lib/a.ts"]);
  });
});

describe("pathsRelated", () => {
  it("matches the same file", () => {
    expect(pathsRelated("lib/auth/session.ts", "lib/auth/session.ts")).toBe(true);
  });

  it("matches a file inside a cited directory", () => {
    expect(pathsRelated("src/auth", "src/auth/tokens.ts")).toBe(true);
    expect(pathsRelated("src/auth/", "src/auth/tokens.ts")).toBe(true);
  });

  it("matches a sibling in the same folder", () => {
    expect(pathsRelated("lib/auth/session.ts", "lib/auth/tokens.ts")).toBe(true);
  });

  it("matches a file that moved", () => {
    expect(pathsRelated("lib/session.ts", "app/lib/session.ts")).toBe(true);
  });

  it("does not match an unrelated corner of the repo", () => {
    expect(pathsRelated("lib/auth/session.ts", "docs/readme.md")).toBe(false);
    expect(pathsRelated("lib/auth/session.ts", "components/ui/button.tsx")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Tier 1                                                              */
/* ------------------------------------------------------------------ */

const IDEA = {
  title: "Rate-limit the login endpoint",
  body: "Evidence: `lib/auth/session.ts:42` has no throttle at all.",
};

describe("evaluateTier1", () => {
  it("is not a candidate when nothing has landed", () => {
    const got = evaluateTier1(IDEA, [], APPROVED_AT);
    expect(got.candidate).toBe(false);
    expect(got.humanCommits).toBe(0);
    expect(got.reason).toMatch(/No hand-written commits/);
  });

  it("discounts loop commits entirely", () => {
    const got = evaluateTier1(
      IDEA,
      [
        commit({ isHuman: false, author: "claude[bot]" }),
        commit({ isHuman: false, author: "github-actions[bot]", sha: "b" }),
      ],
      APPROVED_AT,
    );
    expect(got.candidate).toBe(false);
    expect(got.loopCommits).toBe(2);
    expect(got.humanCommits).toBe(0);
    expect(got.reason).toMatch(/loop commits, which don't count/);
  });

  it("ignores commits that predate the approval", () => {
    const got = evaluateTier1(
      IDEA,
      [commit({ committedAt: "2026-08-01T00:00:00Z" })],
      APPROVED_AT,
    );
    expect(got.humanCommits).toBe(0);
    expect(got.candidate).toBe(false);
  });

  it("flags one human commit that touched a cited path", () => {
    const got = evaluateTier1(IDEA, [commit()], APPROVED_AT);
    expect(got.candidate).toBe(true);
    expect(got.relatedness).toBe("related");
    expect(got.matchedPaths).toEqual(["lib/auth/session.ts"]);
    // The comment this feeds has to be concrete: a count, a path and a date.
    expect(got.reason).toMatch(/1 hand-written commit/);
    expect(got.reason).toMatch(/lib\/auth\/session\.ts/);
    expect(got.reason).toMatch(/12 Aug 2026/);
    expect(MIN_HUMAN_COMMITS).toBe(1);
  });

  it("does not flag human commits in an unrelated corner of the repo", () => {
    const got = evaluateTier1(
      IDEA,
      [
        commit({ files: ["docs/readme.md"] }),
        commit({ sha: "b", files: ["public/logo.svg"] }),
      ],
      APPROVED_AT,
    );
    expect(got.candidate).toBe(false);
    expect(got.relatedness).toBe("unrelated");
    expect(got.reason).toMatch(/none of them went near/);
  });

  it("falls back to the volume rule when the idea cites no files", () => {
    const vague = { title: "Make it faster", body: "It feels slow." };
    const few = Array.from({ length: VOLUME_ONLY_THRESHOLD - 1 }, (_, i) =>
      commit({ sha: `s${i}`, files: ["docs/readme.md"] }),
    );
    expect(evaluateTier1(vague, few, APPROVED_AT).candidate).toBe(false);

    const many = Array.from({ length: VOLUME_ONLY_THRESHOLD }, (_, i) =>
      commit({ sha: `s${i}`, files: ["docs/readme.md"] }),
    );
    const got = evaluateTier1(vague, many, APPROVED_AT);
    // The worst-specified approvals must not be the only ones that can never
    // be flagged — that would be exactly backwards.
    expect(got.candidate).toBe(true);
    expect(got.relatedness).toBe("unknown");
    expect(got.reason).toMatch(/flagged on volume alone/);
  });

  it("treats an unread file list as unknown, never as unrelated", () => {
    // Empty `files` means "we did not look" (the lookup budget ran out), not
    // "it touched nothing". Reading it as unrelated would silently clear ideas
    // nobody actually checked.
    const many = Array.from({ length: VOLUME_ONLY_THRESHOLD }, (_, i) =>
      commit({ sha: `s${i}`, files: [] }),
    );
    const got = evaluateTier1(IDEA, many, APPROVED_AT);
    expect(got.relatedness).toBe("unknown");
    expect(got.candidate).toBe(true);
  });

  it("carries the imprecise-date wording through into the reason", () => {
    const got = evaluateTier1(IDEA, [commit()], {
      at: APPROVED,
      source: "updated-at",
      precise: false,
      caveat: "…",
    });
    // A comment that says "approved on 12 Aug" when we only know "last touched
    // on 12 Aug" is the kind of quiet inaccuracy that makes a feature
    // untrustable, so the phrasing has to change with the source.
    expect(got.reason).toMatch(/last touched on 12 Aug 2026/);
    expect(got.reason).not.toMatch(/it was approved on/);
  });
});
