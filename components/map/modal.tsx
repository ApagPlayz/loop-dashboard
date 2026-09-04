"use client";

import { useEscapeKey } from "./use-escape";

/**
 * Shared centered-modal shell for the map page's overlays (agent details,
 * loop power, setup checklist). Replaces the old side-drawer/bottom-sheet
 * pattern with one consistent, larger rectangle centered on screen so more
 * content is visible at once. Near-fullscreen on narrow screens.
 *
 * Closes on Escape, on a backdrop click, or however the caller's own header
 * (rendered as `children`) wires up its close button. Callers own their
 * header/tabs/body markup and just supply sizing via `className`.
 *
 * Escape goes through the shared overlay stack (`useEscapeKey`) so a modal
 * opened on top of another one — the tool catalog over the agent drawer —
 * closes only itself, instead of collapsing the whole stack at once.
 */
export default function Modal({
  onClose,
  children,
  className = "",
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** Extra classes on the modal rectangle — set width/height/max-width here. */
  className?: string;
}) {
  useEscapeKey(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`relative flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
