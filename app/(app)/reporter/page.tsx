import PageHeader from "@/components/page-header";
import ReporterView from "@/components/reporter/reporter-view";
import { getDigest, hasCachedDigest } from "@/lib/reporter";
import type { Digest } from "@/lib/reporter-types";
import { isPublicViewer } from "@/lib/demo/viewer";

// The digest lives in a tmp-file cache; render from it on each request.
export const dynamic = "force-dynamic";

export default async function ReporterPage() {
  // Load instantly from cache when we have one; otherwise let the client fetch
  // (and build) so the first-ever visit doesn't block the whole page render.
  //
  // Demo: never touch the cache-backed digest helpers for an anonymous
  // visitor. That cache is the real owner's tmp-file state, not part of the
  // demo snapshot, and building a fresh one here would try to pull every
  // source live on a public page render. Render as if nothing were cached;
  // the client then falls through to GET /api/reporter, which the proxy
  // already answers from a frozen fixture.
  let initial: Digest | null = null;
  if (!(await isPublicViewer()) && hasCachedDigest()) {
    try {
      initial = await getDigest();
    } catch {
      initial = null;
    }
  }

  return (
    <>
      <PageHeader
        title="News"
        description="What's new in Claude Code, Claude models, MCP servers, skills, plugins, and agentic automation — compiled from trusted sources."
      />
      <ReporterView initialDigest={initial} />
    </>
  );
}
