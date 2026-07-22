"use client";

import { Loader2 } from "lucide-react";

/**
 * Reusable pill on/off switch. Extracted from the inline pattern in
 * components/map/power-menu.tsx (workflow enable/disable toggles) so it can
 * be reused elsewhere — that original usage is untouched.
 */
export default function ToggleSwitch({
  checked,
  onChange,
  busy = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      aria-label={label}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${
        checked ? "bg-emerald-500" : "bg-zinc-700"
      }`}
    >
      {busy ? (
        <Loader2 className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-zinc-100" />
      ) : (
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-zinc-100 transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      )}
    </button>
  );
}
