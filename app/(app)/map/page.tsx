import PageHeader from "@/components/page-header";
import ProcessMap from "@/components/map/process-map";

export const dynamic = "force-dynamic";

export default function MapPage() {
  return (
    <>
      <PageHeader
        title="Process Map"
        description="The whole loop at a glance — tap any agent to see what it does, edit its instructions, or run it now."
      />
      <ProcessMap />
    </>
  );
}
