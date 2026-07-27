"use client";

import { useEffect, useRef } from "react";

const STEPS: Array<number | "unlimited"> = [10, 25, 50, 100, "unlimited"];

function nearestStepIndex(value: number | "unlimited"): number {
  const exact = STEPS.indexOf(value);
  if (exact !== -1) return exact;
  if (value === "unlimited") return STEPS.length - 1;
  // Value came from an older/manual config that isn't one of our stops —
  // snap to the closest numeric step rather than erroring.
  let closest = 0;
  let closestDiff = Infinity;
  STEPS.forEach((step, i) => {
    if (typeof step !== "number") return;
    const diff = Math.abs(step - value);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = i;
    }
  });
  return closest;
}

/**
 * Draggable idea-queue cap control. No range/slider primitive existed in
 * this codebase, so this is built from scratch on a native <input
 * type="range">, snapped to five discrete stops (10/25/50/100/Unlimited)
 * rather than a free numeric range.
 */
export default function CapSlider({
  value,
  onChange,
  onNormalize,
  disabled = false,
}: {
  value: number | "unlimited";
  /** The owner dragged the slider. This IS an edit. */
  onChange: (next: number | "unlimited") => void;
  /**
   * The incoming value wasn't one of our stops and got snapped. This is NOT
   * an edit the owner made, so the parent must apply it to its baseline as
   * well as its draft — otherwise the panel reads as dirty on page load.
   * Required on purpose: routing this through `onChange` is the bug.
   */
  onNormalize: (next: number | "unlimited") => void;
  disabled?: boolean;
}) {
  const index = nearestStepIndex(value);
  const snapped = STEPS[index];
  const display = snapped === "unlimited" ? "Unlimited" : snapped;

  // A stored value that isn't one of our stops (e.g. a hand-edited config with
  // 30) would otherwise DISPLAY as 25 while 30 stayed saved. Push the snapped
  // value up once so what's shown and what would be saved always agree — via
  // `onNormalize`, not `onChange`, so nobody's Save button lights up over a
  // change they didn't make. The callback is read through a ref so an inline
  // parent callback doesn't re-trigger (and cancel) this on every render.
  const onNormalizeRef = useRef(onNormalize);
  useEffect(() => {
    onNormalizeRef.current = onNormalize;
  });
  useEffect(() => {
    if (snapped === value) return;
    // Defer so we don't call the parent's setState synchronously in the effect
    // body (same pattern as the other panels here).
    const t = setTimeout(() => onNormalizeRef.current(snapped), 0);
    return () => clearTimeout(t);
  }, [value, snapped]);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm text-zinc-300">Idea queue cap</span>
        <span className="text-sm font-semibold text-zinc-100">{display}</span>
      </div>
      <input
        type="range"
        min={0}
        max={STEPS.length - 1}
        step={1}
        value={index}
        disabled={disabled}
        onChange={(e) => onChange(STEPS[Number(e.target.value)])}
        className="w-full accent-emerald-500 disabled:opacity-50"
        aria-label="Idea queue cap"
      />
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        {STEPS.map((step) => (
          <span key={step}>{step === "unlimited" ? "Unlimited" : step}</span>
        ))}
      </div>
    </div>
  );
}
