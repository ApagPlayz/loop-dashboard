import PageHeader from "@/components/page-header";
import TemplateEditor from "@/components/map/template-editor";

export const dynamic = "force-dynamic";

export default function TemplatePage() {
  return (
    <>
      <PageHeader
        title="New-project template"
        description="The starting loop every new project gets. Change it by chatting with AI — future projects pick it up automatically."
      />
      <TemplateEditor />
    </>
  );
}
