import { Construction } from "lucide-react";

/**
 * Placeholder empty state for pages a feature agent will build out. Replace the
 * whole page when implementing the real section.
 */
export default function UnderConstruction({ note }: { note?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
        <Construction className="h-6 w-6 text-zinc-400" />
      </div>
      <p className="text-sm font-medium text-zinc-300">Under construction</p>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">
        {note ?? "Another agent is building this section. Check back soon."}
      </p>
    </div>
  );
}
