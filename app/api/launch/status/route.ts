import { NextResponse } from "next/server";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";
import { launcherStatus } from "@/lib/launchers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/launch/status?project=
 * Whether the project has a launcher and whether the product is running.
 * Returns { configured, running, url?, kind?, analyzedAt?, notes? }.
 */
export async function GET(req: Request) {
  try {
    const { project } = await resolveProjectFromUrl(req.url);
    const status = await launcherStatus(project.key);
    return NextResponse.json({
      configured: status.exists,
      running: status.running,
      url: status.url ?? null,
      kind: status.kind ?? null,
      analyzedAt: status.analyzedAt ?? null,
      notes: status.notes ?? null,
    });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("launch/status: failed", err);
    return NextResponse.json(
      { error: "Couldn't check the launcher's status. Try again." },
      { status: 502 },
    );
  }
}
