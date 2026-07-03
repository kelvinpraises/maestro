// confetti-burst.tsx — THE one confetti (DESIGN-STORY §3.6, §5).
//
// Fires exactly once, when a reward's money lands in the kid's stash. Nothing
// else in the app celebrates with confetti — sparkle sprinkles may stay, but the
// falling burst is reserved for this single moment.
//
// In-voice + dependency-free: each piece is an ink-outlined, tinted rectangle
// (the "chunky card" material, shrunk to a scrap) that drops, drifts, and spins
// for ~1.5s, then the whole layer unmounts. No canvas, no library. Honors
// prefers-reduced-motion by rendering nothing (the count-up carries the moment).

import { useEffect, useMemo, useRef, useState } from "react";

// The reward-tile palette, as CSS-var references so it tracks light/dark.
const TINTS = [
  "var(--m-gold)",
  "var(--m-mint)",
  "var(--m-sky)",
  "var(--m-lilac)",
  "var(--m-blush)",
  "var(--m-green)",
];

const PIECE_COUNT = 26;
const DURATION_MS = 1500;

interface Piece {
  left: number; // vw start
  delay: number; // ms
  duration: number; // ms
  drift: number; // px horizontal drift
  spin: number; // deg total rotation
  size: number; // px (short side)
  ratio: number; // long/short
  color: string;
}

function makePieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, () => {
    const size = 7 + Math.random() * 7; // 7–14px
    return {
      left: Math.random() * 100,
      delay: Math.random() * 250,
      duration: DURATION_MS - 350 + Math.random() * 350,
      drift: (Math.random() - 0.5) * 160,
      spin: (Math.random() - 0.5) * 720,
      size,
      ratio: 1.4 + Math.random() * 1.4,
      color: TINTS[Math.floor(Math.random() * TINTS.length)],
    };
  });
}

/**
 * A one-shot confetti layer. Mount it (e.g. `{claimed && <ConfettiBurst />}`)
 * to fire; it self-removes ~1.5s later and calls `onDone`. Keyed remounts refire.
 * Renders a fixed, pointer-transparent overlay so it never blocks taps.
 */
export function ConfettiBurst({ onDone }: { onDone?: () => void }) {
  const [gone, setGone] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const pieces = useMemo(() => (reduce ? [] : makePieces()), [reduce]);

  useEffect(() => {
    if (reduce) {
      doneRef.current?.();
      return;
    }
    const t = setTimeout(() => {
      setGone(true);
      doneRef.current?.();
    }, DURATION_MS + 300);
    return () => clearTimeout(t);
  }, [reduce]);

  if (reduce || gone) return null;

  return (
    <div
      aria-hidden
      data-confetti-burst
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-[-6%] block border-2 border-m-ink"
          style={{
            left: `${p.left}vw`,
            width: `${p.size * p.ratio}px`,
            height: `${p.size}px`,
            background: p.color,
            borderRadius: "2px",
            boxShadow: "1px 1px 0 0 var(--m-ink)",
            animation: `confetti-fall ${p.duration}ms cubic-bezier(0.3,0,0.6,1) ${p.delay}ms both`,
            // per-piece drift + spin fed to the shared keyframes via CSS vars
            ["--confetti-drift" as string]: `${p.drift}px`,
            ["--confetti-spin" as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}
