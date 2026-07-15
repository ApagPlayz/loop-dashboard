import { NextResponse } from "next/server";
import { getFileContent, commitFile } from "@/lib/github";
import { getAgent, TARGET_REPO } from "@/lib/map-agents";
import { extractPrompt, replacePrompt } from "@/lib/map-yaml";

export const dynamic = "force-dynamic";

/**
 * POST /api/map/agent/[id]/instructions
 * Save edited instructions straight to the target repo's main branch.
 *
 * Body: { mode: "prompt", prompt: string }  — splice friendly text back in
 *   or   { mode: "raw", rawYaml: string }    — overwrite the whole file
 *
 * Returns: { commitUrl, historyUrl }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = getAgent(id);
  if (!meta) return NextResponse.json({ error: "Unknown agent." }, { status: 404 });

  if (!meta.onMain) {
    return NextResponse.json(
      { error: "This workflow isn't on the main branch yet (waiting for PR #44 to merge), so it can't be edited." },
      { status: 409 },
    );
  }

  let body: { mode?: string; prompt?: string; rawYaml?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const path = `.github/workflows/${meta.file}`;

  try {
    const current = await getFileContent(path, "main");
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
    const res = await commitFile(path, newYaml, `dashboard: edit ${label} instructions`);

    const commitUrl =
      (res as { commit?: { html_url?: string } }).commit?.html_url ??
      `https://github.com/${TARGET_REPO.owner}/${TARGET_REPO.repo}/commits/main/${path}`;

    return NextResponse.json({
      ok: true,
      commitUrl,
      historyUrl: `https://github.com/${TARGET_REPO.owner}/${TARGET_REPO.repo}/commits/main/${path}`,
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
