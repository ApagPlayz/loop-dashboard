"use client";

import { useState } from "react";
import { Store, X } from "lucide-react";
import Modal from "@/components/map/modal";
import CatalogBrowser from "@/components/tools/catalog-browser";

/**
 * The tool marketplace as a pop-open modal instead of one long inline list.
 *
 * A button describes the marketplace; clicking it opens a large centered modal
 * whose body scrolls, with the full catalog (its own search bar + filters +
 * detail/install flow) inside. This keeps the Tools page short — the whole
 * catalogue is one click away rather than always expanded.
 */
export default function ToolCatalogModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition hover:border-emerald-500/40 hover:bg-zinc-800/60"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
          <Store className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-zinc-100">Browse the tool marketplace</span>
          <span className="block text-xs text-zinc-400">
            Search every MCP server, skill, and plugin we know about, then install with one click.
          </span>
        </span>
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} className="h-[85vh] max-w-5xl">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Store className="h-4 w-4 text-emerald-400" />
              Tool marketplace
            </h2>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <CatalogBrowser install={{ mode: "all" }} />
          </div>
        </Modal>
      )}
    </>
  );
}
