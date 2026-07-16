import { NextResponse } from "next/server";
import { resolveProject, ProjectError } from "@/lib/projects";
import { AiError } from "@/lib/map-ai";
import { launchProject } from "@/lib/launchers";

export const dynamic = "force-dynamic";
// Launching runs `open` on the owner's Mac — Node runtime.
export const runtime = "nodejs";

/**
 * POST /api/launch/run  Body: { project }
 * Launch the product via its generated .command file. If it's already
 * answering, returns { alreadyRunning: true, url } and the client just opens it.
 */
export async function POST(req: Request) {
  let body: { project?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const { project } = await resolveProject(body.project);
    const result = await launchProject(project.key);
    return NextResponse.json({
      alreadyRunning: result.alreadyRunning,
      url: result.url ?? null,
    });
  } catch (err) {
    if (err instanceof ProjectError || err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("launch/run: failed", err);
    return NextResponse.json(
      { error: "Couldn't launch the product. Try again." },
      { status: 502 },
    );
  }
}
