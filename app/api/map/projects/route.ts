import { NextResponse } from "next/server";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/map/projects — the registered projects. */
export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (err) {
    console.error("projects: list failed", err);
    return NextResponse.json(
      { error: "Couldn't load the project list. Try again." },
      { status: 502 },
    );
  }
}
