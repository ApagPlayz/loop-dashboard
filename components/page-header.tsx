/**
 * Standard page title block. Every top-level page should start with this so
 * headers stay consistent across sections.
 */
export default function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-zinc-400">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
