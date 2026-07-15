import PageHeader from "@/components/page-header";
import UnderConstruction from "@/components/under-construction";

export default function TestingPage() {
  return (
    <>
      <PageHeader
        title="Testing"
        description="Run checks against the loop and review test results."
      />
      <UnderConstruction note="The Testing agent will add test triggers and result views here." />
    </>
  );
}
