import { NextResponse } from "next/server";
import { getFileContent, commitFile } from "@/lib/github";
import { extractPrompt, replacePrompt } from "@/lib/map-yaml";
import { resolveProjectFromUrl, findProjectAgent, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/map/agent/[id]/instructions?project=<key>
 * Save edited instructions straight to the project repo's main branch.
 *
 * Body: { mode: "prompt", prompt: string }  — splice friendly text back in
 *   or   { mode: "raw", rawYaml: string }    — overwrite the whole file
 *
 * Returns: { commitUrl, historyUrl }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let project, repo;
  try {
    ({ project, repo } = await resolveProjectFromUrl(req.url));
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
  const meta = await findProjectAgent(project, id);
  if (!meta) return NextResponse.json({ error: "Unknown agent." }, { status: 404 });

  let body: { mode?: string; prompt?: string; rawYaml?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const path = `.github/workflows/${meta.file}`;

  try {
    const current = await getFileContent(path, "main", repo);
    if (current === null) {
      return NextResponse.json(
        { error: "Couldn't find the workflow file on main." },
        { status: 404 },
      );
    }

    let newYaml: string;
    if (body.mode === "raw") {
      if (typeof body.rawYaml !== "string" || body.rawYaml.trim() === "") {
        return NextResponse.json({ error: "The file can't be empty." }, { status: 400 });
      }
      newYaml = body.rawYaml;
    } else {
      if (typeof body.prompt !== "string") {
        return NextResponse.json({ error: "Missing the instructions text." }, { status: 400 });
      }
      const check = extractPrompt(current);
      if (!check.ok) {
        return NextResponse.json(
          {
            error:
              "These instructions can't be edited in the simple view — use 'Edit full file' instead.",
          },
          { status: 422 },
        );
      }
      newYaml = replacePrompt(current, body.prompt);
    }

    if (newYaml === current) {
      return NextResponse.json({ error: "No changes to save." }, { status: 400 });
    }

    const label = meta.label.replace(/^@/, "");
    const res = await commitFile(path, newYaml, `dashboard: edit ${label} instructions`, {
      repo,
    });

    const commitUrl =
      (res as { commit?: { html_url?: string } }).commit?.html_url ??
      `https://github.com/${repo.owner}/${repo.repo}/commits/main/${path}`;

    return NextResponse.json({
      ok: true,
      commitUrl,
      historyUrl: `https://github.com/${repo.owner}/${repo.repo}/commits/main/${path}`,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 409) {
      return NextResponse.json(
        {
          error:
            "Someone else changed this file while you were editing. Close and reopen this panel to get the latest version, then try again.",
        },
        { status: 409 },
      );
    }
    console.error(`instructions[${id}]: save failed`, err);
    return NextResponse.json(
      { error: "Couldn't save to GitHub. Please try again." },
      { status: 502 },
    );
  }
}
