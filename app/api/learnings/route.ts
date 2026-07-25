import { NextResponse } from "next/server";
import { getFileContent, getOctokit } from "@/lib/github";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

// Always fetch fresh from GitHub on each request.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type RetroCommit = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string | null;
  url: string;
};

export type LearningsPayload = {
  markdown: string | null;
  lineCount: number;
  retros: RetroCommit[];
};

/** GET /api/learnings — LEARNINGS.md + the recent retro commit history. */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);

    const markdown = await getFileContent("LEARNINGS.md", undefined, repo);
    const lineCount = markdown ? markdown.split("\n").length : 0;

    let retros: RetroCommit[] = [];
    try {
      const res = await getOctokit().rest.repos.listCommits({
        owner: repo.owner,
        repo: repo.repo,
        path: "LEARNINGS.md",
        per_page: 15,
      });
      retros = res.data.map((c) => ({
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0],
        author: c.author?.login ?? c.commit.author?.name ?? "unknown",
        date: c.commit.author?.date ?? c.commit.committer?.date ?? null,
        url: c.html_url,
      }));
    } catch (err) {
      // Best-effort: the page still works with just the markdown.
      console.error("learnings: commit history failed", err);
      retros = [];
    }

    const payload: LearningsPayload = { markdown, lineCount, retros };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("learnings: load failed", err);
    return NextResponse.json(
      { error: "Couldn't load learnings from GitHub. Try again." },
      { status: 502 },
    );
  }
}
