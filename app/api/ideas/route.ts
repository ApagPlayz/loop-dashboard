import { NextResponse } from "next/server";
import { loadIdeas } from "@/lib/queues";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";
// loadIdeas paginates several label queries against GitHub; give it headroom
// on a large repo rather than letting the platform's short default cut it off.
export const maxDuration = 60;

/** GET /api/ideas?project=<key> — all four Ideas tabs with their issues. */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const data = await loadIdeas(repo);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json(
      { error: errorMessage(err) },
      { status: 502 },
    );
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not reach GitHub. Try again in a moment.";
}
