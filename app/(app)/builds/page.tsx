import PageHeader from "@/components/page-header";
import BuildsView from "@/components/queues/builds-view";

export const dynamic = "force-dynamic";

export default function BuildsPage() {
  return (
    <>
      <PageHeader
        title="Builds & Evidence"
        description="Review each build, watch the demo proof, then approve and merge — or send it back."
      />
      <BuildsView />
    </>
  );
}
