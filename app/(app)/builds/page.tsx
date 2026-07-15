import PageHeader from "@/components/page-header";
import UnderConstruction from "@/components/under-construction";

export default function BuildsPage() {
  return (
    <>
      <PageHeader
        title="Builds & Evidence"
        description="Builder pull requests, Auditor reviews, and the evidence behind each change."
      />
      <UnderConstruction note="The Builds agent will show open PRs, audit status, and artifacts here." />
    </>
  );
}
