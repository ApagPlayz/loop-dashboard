import PageHeader from "@/components/page-header";
import ProjectEditScreen from "@/components/map/project-edit-screen";

export const dynamic = "force-dynamic";

export default async function ProjectEditPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  return (
    <>
      <PageHeader
        title="Edit a project with AI"
        description="Chat about what should change in this project's loop — review the exact changes, then apply them in one tap."
      />
      <ProjectEditScreen projectKey={decodeURIComponent(project)} />
    </>
  );
}
