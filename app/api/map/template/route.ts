import { NextResponse } from "next/server";
import { listTemplateWorkflows } from "@/lib/loop-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/template — the state of the new-project template.
 * Returns: { exists: boolean, files: string[] }
 */
export async function GET() {
  try {
    const workflows = await listTemplateWorkflows();
    const files = [...workflows.keys()].sort();
    return NextResponse.json({ exists: files.length > 0, files });
  } catch (err) {
    console.error("template: read failed", err);
    return NextResponse.json(
      { error: "Couldn't read the template from GitHub. Try again." },
      { status: 502 },
    );
  }
}
