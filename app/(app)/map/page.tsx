import PageHeader from "@/components/page-header";
import UnderConstruction from "@/components/under-construction";

export default function MapPage() {
  return (
    <>
      <PageHeader
        title="Process Map"
        description="Visual map of the autonomous loop — Scout, Builder, Auditor, Retro, Metrics."
      />
      <UnderConstruction note="The Process Map agent will build an interactive React Flow diagram here." />
    </>
  );
}
