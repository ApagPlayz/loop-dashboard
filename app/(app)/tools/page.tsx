import PageHeader from "@/components/page-header";
import UnderConstruction from "@/components/under-construction";

export default function ToolsPage() {
  return (
    <>
      <PageHeader
        title="Tools"
        description="Manual controls — dispatch workflows, send @claude commands, manage labels."
      />
      <UnderConstruction note="The Tools agent will add workflow-dispatch and remote-control actions here." />
    </>
  );
}
