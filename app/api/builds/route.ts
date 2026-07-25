import { NextResponse } from "next/server";
import { loadBuilds } from "@/lib/queues";
import { resolveProjectFromUrl } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** GET /api/builds — the three Builds tabs (needs review / merged / closed). */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const data = await loadBuilds(repo);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "GitHub request failed." },
      { status: 502 },
    );
  }
}
