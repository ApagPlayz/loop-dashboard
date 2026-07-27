"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * Safety net for every page inside the app shell.
 *
 * Without this file, ANY render-phase throw — an unreadable project registry, a
 * GitHub blip inside a server component, a bad shape from an API — took the
 * whole screen white. This catches the segment and its children (the shell in
 * layout.tsx above it keeps rendering, so the nav and project switcher survive
 * and the owner can just click somewhere else).
 *
 * Next 16.2 hands the boundary `unstable_retry()`, which re-fetches AND
 * re-renders the children — the right button for transient failures. (`reset()`
 * only clears the error state without re-fetching, which would usually just
 * re-throw here.)
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("app segment error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
            aria-hidden
          />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-zinc-100">
              This page didn&apos;t load
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Something went wrong while building this screen — usually a
              hiccup talking to GitHub. Nothing was changed. Try again, or pick
              another section from the menu.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
            Try again
          </button>
          {error.digest && (
            <span className="font-mono text-[11px] text-zinc-600">
              ref {error.digest}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
