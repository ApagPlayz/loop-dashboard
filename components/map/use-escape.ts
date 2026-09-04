"use client";

import { useEffect, useRef } from "react";

/**
 * "Escape closes the top overlay, and only the top overlay."
 *
 * Every overlay in this app closes on Escape. The naive way — each overlay
 * adding its own `window` keydown listener — breaks the moment two of them are
 * stacked (the agent drawer with the tool catalog opened on top of it, the
 * project dropdown with the add-a-project wizard over it): one Escape fires
 * every listener and the whole stack collapses at once.
 *
 * So the overlays share one listener and one LIFO stack instead. The last
 * overlay to mount is the one on top, so it is the one Escape reaches; closing
 * it pops the stack and the next Escape reaches the one underneath.
 *
 * Deliberately module-level rather than a context: overlays here are rendered
 * from many unrelated places (a dropdown in a toolbar, a modal from a drawer)
 * and none of them share a provider.
 */

type Entry = { close: () => void };

const stack: Entry[] = [];
let listening = false;

function onKeyDown(e: KeyboardEvent) {
  // `isComposing` guard: Escape while an IME candidate window is open is the
  // user dismissing that, not the overlay.
  if (e.key !== "Escape" || e.isComposing) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  top.close();
}

/**
 * Close this overlay when Escape is pressed and it is the topmost open one.
 *
 * `active` lets a component register conditionally without breaking the rule
 * that hooks run unconditionally — pass `false` while the overlay is closed.
 */
export function useEscapeKey(onEscape: () => void, active = true) {
  // Keep the latest callback without re-registering (and so re-ordering) the
  // stack entry on every render.
  const cb = useRef(onEscape);
  useEffect(() => {
    cb.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const entry: Entry = { close: () => cb.current() };
    stack.push(entry);
    if (!listening) {
      window.addEventListener("keydown", onKeyDown);
      listening = true;
    }
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      if (stack.length === 0 && listening) {
        window.removeEventListener("keydown", onKeyDown);
        listening = false;
      }
    };
  }, [active]);
}
