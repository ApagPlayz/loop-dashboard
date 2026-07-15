import PageHeader from "@/components/page-header";
import TestingView from "@/components/testing/testing-view";

export default function TestingPage() {
  return (
    <>
      <PageHeader
        title="Testing"
        description="Run any agent by hand, watch it live, check the test suite, and see whether your instruction changes are helping."
      />
      <TestingView />
    </>
  );
}
