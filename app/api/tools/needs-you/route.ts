import { NextResponse } from "next/server";
import { listActionNeededIssues } from "@/lib/tools";
import { resolveProjectFromUrl, ProjectError } from "@/lib/projects";

export const dynamic = "force-dynamic";

/**
 * GET /api/tools/needs-you?project=<key>
 * Open "🔑 Action needed" issues the owner has to act on, in ONE project.
 *
 * `project` is required: this used to read the pilot's repo whatever the
 * switcher said, so the Tools page showed another project's tasks.
 */
export async function GET(req: Request) {
  try {
    const { repo } = await resolveProjectFromUrl(req.url);
    const issues = await listActionNeededIssues(repo);
    return NextResponse.json({ issues });
  } catch (err) {
    if (err instanceof ProjectError) {
      return NextResponse.json(
        { issues: [], error: err.message },
        { status: err.httpStatus },
      );
    }
    return NextResponse.json(
      { issues: [], error: "Could not load tasks." },
      { status: 500 },
    );
  }
}
