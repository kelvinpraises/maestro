// use-count-up.ts — animate a number from its previous value to a new one, ease-out.
//
// Per DESIGN-STORY §3.5 "money numbers count up". Used when the stash balance
// jumps after a Scoop. This is allowed to feel GOOD (§4 allowance survivor) but
// stays short and calm — no overshoot, no confetti (confetti is reserved for
// reward claims, §3.6). Reduced-motion: snaps straight to the target.

import { useEffect, useRef, useState } from "react";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Returns a value that eases from its last settled value to `target` over
 * `durationMs` whenever `target` changes. First render shows `target` directly
 * (no count-up on mount).
 */
export function useCountUp(target: number, durationMs = 800): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Don't animate the very first value we see — only subsequent changes.
    if (!mountedRef.current) {
      mountedRef.current = true;
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeOut(t);
      setDisplay(from + (target - from) * eased);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return display;
}
