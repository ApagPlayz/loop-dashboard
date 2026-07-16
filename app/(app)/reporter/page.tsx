import PageHeader from "@/components/page-header";
import ReporterView from "@/components/reporter/reporter-view";
import { getDigest, hasCachedDigest } from "@/lib/reporter";
import type { Digest } from "@/lib/reporter-types";

// The digest lives in a tmp-file cache; render from it on each request.
export const dynamic = "force-dynamic";

export default async function ReporterPage() {
  // Load instantly from cache when we have one; otherwise let the client fetch
  // (and build) so the first-ever visit doesn't block the whole page render.
  let initial: Digest | null = null;
  if (hasCachedDigest()) {
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
