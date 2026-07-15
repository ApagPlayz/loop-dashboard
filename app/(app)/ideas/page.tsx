import PageHeader from "@/components/page-header";
import IdeasView from "@/components/queues/ideas-view";

export const dynamic = "force-dynamic";

export default function IdeasPage() {
  return (
    <>
      <PageHeader
        title="Ideas"
        description="Approve the Scout's proposals, send them back for a rewrite, or reject them."
      />
      <IdeasView />
    </>
  );
}
