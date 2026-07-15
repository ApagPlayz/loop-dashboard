import PageHeader from "@/components/page-header";
import UnderConstruction from "@/components/under-construction";

export default function IdeasPage() {
  return (
    <>
      <PageHeader
        title="Ideas"
        description="Scout proposals waiting for approval, and the ideas backlog."
      />
      <UnderConstruction note="The Ideas agent will list Scout issues and add approve/reject controls here." />
    </>
  );
}
