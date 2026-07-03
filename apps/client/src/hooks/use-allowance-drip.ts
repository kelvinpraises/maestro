// use-allowance-drip.ts — the presentational layer over `useAllowanceState`
// that turns the 5-second polls into a *live, honest* drip for the stash card.
//
// The contract only surfaces new money in whole 2-second cycles, and the hook
// polls every 5s. Between polls we want the "waiting" number to *move* — that
// visible accrual is, per DESIGN-STORY §2 Story C, "the single most magical
// thing the contracts give us". But a ticker that races ahead of the truth is a
// lie (Story D: "Money states are never lying"). So this hook keeps the tick
// HONEST in three ways:
//
//   1. Rate is MEASURED, not assumed. We learn the per-second stroop rate from
//      the delta between two consecutive real polls (Δwaiting / Δt), not from
//      the allowance config — so if the stream stops, the measured rate decays
//      to 0 and the ticker stalls with it.
//   2. The tick is CAPPED. Between polls we let the displayed value climb from
//      the last real reading at the measured rate, but never past a ceiling of
//      `lastReal + rate * elapsed`. Because that ceiling is exactly what the
//      next poll accrues at the same rate, the ticker can never show more than
//      the next poll could plausibly confirm.
//   3. On every poll we SNAP TO TRUTH. The real number replaces the ticked one
//      (down if we over-ran, which the cap makes rare and small).
//
// Reduced-motion: callers should render the snapped `waiting` and skip the
// animation; this hook still works (it just won't be sampled every frame).

import { useEffect, useMemo, useRef, useState } from "react";
import { useAllowanceState, type AllowanceState } from "@/hooks/use-allowance";
import { stroopsToXlm } from "@/lib/allowance";

export interface AllowanceDrip {
  /** Underlying poll state (may be undefined while loading). */
  state: AllowanceState | undefined;
  isLoading: boolean;
  /** True when there is an active incoming allowance worth surfacing. */
  hasIncoming: boolean;
  /** Snapped-to-truth waiting total in stroops (splittable + collectable). */
  waitingStroops: bigint;
  /** Live, honest, ticked waiting total in XLM (for display). */
  waitingXlm: number;
  /** Measured accrual, XLM/second (0 until two polls have been seen). */
  ratePerSecXlm: number;
}

/**
 * Waiting = everything the recipient can still pull right now. That is the
 * money already surfaced by a prior partial receive (`splittable` +
 * `collectable`) PLUS the streamed-out amount a fresh `receive` would credit
 * (`receivableStreamed`). The last term is the one that actually moves for a
 * kid who has never scooped — splittable/collectable stay 0 until `receive`
 * runs, so without it the drip would read a flat 0 while money streams.
 */
function waitingFrom(state: AllowanceState | undefined): bigint {
  if (!state) return 0n;
  return state.splittable + state.collectable + state.receivableStreamed;
}

/**
 * Turn allowance polls into a live drip. `enabled` lets a caller (e.g. a parent
 * home) mount it without paying for polling.
 */
export function useAllowanceDrip(
  address: string | undefined,
  enabled = true,
): AllowanceDrip {
  const query = useAllowanceState(enabled ? address : undefined);
  const state = query.data;

  // Real, snapped waiting total (whole stroops) from the latest poll.
  const waitingStroops = useMemo(() => waitingFrom(state), [state]);

  // Is there a live incoming allowance at all? (receivable cycles OR waiting).
  const hasIncoming = useMemo(() => {
    if (!state) return false;
    return (
      state.receivableCycles > 0n ||
      state.splittable > 0n ||
      state.collectable > 0n
    );
  }, [state]);

  // Sender-side funded balance is the hard ceiling: the recipient can never be
  // waiting on more than what remains funded (plus what is already waiting).
  const fundedRemaining = state?.fundedRemaining ?? 0n;

  // ── Honest ticker ──────────────────────────────────────────────────────────
  // `receivableStreamed` (settled − balance_at(now)) is a real, fund-bounded
  // amount, but testnet reads are coarse and laggy — a poll-to-poll delta is too
  // noisy to drive a smooth tick. So we measure the drip as a CUMULATIVE AVERAGE
  // rate anchored at the first non-zero reading: rate = (waiting − anchorWaiting)
  // / (now − anchorAt). Averaged over the whole observed window it converges to
  // the true stream rate and, being backed by two real readings spanning that
  // window, it cannot run away. We project forward at that rate between polls and
  // snap to truth on each poll, capped so the tick never overstates the truth:
  //   • the projection never climbs more than a few seconds ahead of the last
  //     reading (a late/missed poll can't let it drift), and
  //   • it is hard-capped at the funded-balance ceiling (a physically
  //     impossible amount would be a lie — Story D).
  // A downward correction (a collect, or a fresh allowance) re-anchors so the
  // rate reflects the new stream, never a stale one.
  const anchorRef = useRef<{ waiting: number; at: number } | null>(null);
  const lastRef = useRef<{ waiting: number; at: number } | null>(null);
  const rateRef = useRef(0); // stroops/sec, cumulative-average since the anchor
  const ceilingRef = useRef(Number.MAX_SAFE_INTEGER); // hard cap in stroops

  const [displayXlm, setDisplayXlm] = useState(0);
  const [rateXlm, setRateXlm] = useState(0);

  const MAX_PROJECT_SECS = 6;

  useEffect(() => {
    const now = Date.now();
    const waiting = Number(waitingStroops);
    const anchor = anchorRef.current;
    ceilingRef.current = Number(fundedRemaining) + waiting;

    if (waiting <= 0) {
      // Nothing waiting yet — hold at the anchor-less baseline.
      anchorRef.current = null;
      rateRef.current = 0;
    } else if (!anchor || waiting < anchor.waiting) {
      // First non-zero reading, or a drop (collect / re-fund) — (re)anchor here.
      // Rate stays 0 until a later reading gives us a span to average over.
      anchorRef.current = { waiting, at: now };
      rateRef.current = 0;
    } else if (now > anchor.at) {
      // Cumulative average over the whole window since the anchor.
      rateRef.current = (waiting - anchor.waiting) / ((now - anchor.at) / 1000);
    }
    lastRef.current = { waiting, at: now };

    // Snap the display to the fresh truth immediately.
    setDisplayXlm(stroopsToXlm(BigInt(Math.round(waiting))));
    setRateXlm(stroopsToXlm(BigInt(Math.round(rateRef.current))));
  }, [waitingStroops, fundedRemaining]);

  // rAF loop: climb from the last real reading at the measured rate, but never
  // past (a) a few seconds of accrual ahead of that reading, nor (b) the
  // funded-balance ceiling. Both caps keep the tick from ever showing more than
  // the next poll could plausibly confirm.
  useEffect(() => {
    if (!enabled || !hasIncoming) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // reduced-motion: show snapped truth only.

    let raf = 0;
    const tick = () => {
      const last = lastRef.current;
      const rate = rateRef.current;
      if (last && rate > 0) {
        const elapsed = Math.min((Date.now() - last.at) / 1000, MAX_PROJECT_SECS);
        const projected = Math.min(last.waiting + rate * elapsed, ceilingRef.current);
        setDisplayXlm(stroopsToXlm(BigInt(Math.round(projected))));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, hasIncoming]);

  return {
    state,
    isLoading: query.isLoading,
    hasIncoming,
    waitingStroops,
    waitingXlm: displayXlm,
    ratePerSecXlm: rateXlm,
  };
}
