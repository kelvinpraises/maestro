// use-auto-scoop.ts — the kid device pulls its own allowance in.
//
// A streamed allowance accrues on-chain; today the kid taps "Scoop it up" to run
// receive → split → collect. The owner wants BOTH: keep that ritual button AND
// quietly auto-collect when a meaningful amount is waiting, so a kid who never
// taps still watches their stash grow on its own.
//
// This hook does NOT own a mutation. It DRIVES the SAME `useCollectAllowance`
// instance the manual button uses — passed in by the card — so `collect.isPending`
// is the one guard both share and auto + manual can never run the pipeline
// concurrently (whichever starts first flips `isPending`; the other's trigger
// short-circuits). No pipeline or claims/allowance semantics change here.
//
// It fires ONLY when ALL of these hold (each one earns its keep):
//   • waiting ≥ AUTO_SCOOP_MIN_XLM — worth the gas the three legs cost.
//   • not already collecting — the shared guard; also skips while a manual scoop
//     or a previous auto-scoop is in flight.
//   • cooldown elapsed since the last auto-scoop — one calm pull per window, no
//     hammering the ledger every poll while money keeps dripping.
//   • the tab is visible — a backgrounded tab signs nothing on its own.
//
// On success it flags a brief, quiet inline note for the card to fade in; NO
// confetti, NO count-up of its own (raising the real balance already runs the
// card's existing count-up). On failure it leans on classifyTxError: a transient
// blip stays SILENT (the next cooldown tick retries naturally), a deterministic
// reject surfaces one honest, kid-safe line instead of a retry that can't win.

import { useCallback, useEffect, useRef, useState } from "react";
import type { useCollectAllowance } from "@/hooks/use-allowance";
import { classifyTxError } from "@/lib/tx-errors";

/**
 * Minimum XLM waiting before an auto-scoop fires. Below this the three-leg
 * receive → split → collect is not worth its gas; the manual button still lets a
 * kid pull any non-zero amount if they want the ritual.
 */
export const AUTO_SCOOP_MIN_XLM = 0.05;

/**
 * Quiet window between auto-scoops. Money keeps dripping in whole 2s cycles, so
 * without a cooldown the hook would try to pull again the instant the next poll
 * showed a few more stroops. One calm pull per minute is plenty; the manual
 * button is always there for an impatient kid.
 */
export const AUTO_SCOOP_COOLDOWN_MS = 60_000;

/** How long the quiet "scooped it in" note lingers before it fades away (ms). */
export const AUTO_SCOOP_NOTE_MS = 4_000;

type CollectMutation = ReturnType<typeof useCollectAllowance>;

export interface AutoScoopState {
  /** True briefly after a successful auto-scoop — the card fades in a quiet note. */
  justScooped: boolean;
  /**
   * Kid-safe line for a DETERMINISTIC auto-scoop failure (a real reject a retry
   * can't fix). Null while healthy or when the failure was merely transient — a
   * blip stays silent and the next cooldown tick retries on its own.
   */
  deterministicError: string | null;
}

/**
 * Auto-collect a kid's streamed allowance when a meaningful amount is waiting,
 * driving the SAME collect mutation the manual button uses so the two can never
 * double-fire. Returns the quiet UI signals the stash card renders.
 *
 * @param collect  the shared `useCollectAllowance()` instance (its `isPending`
 *                 is the guard; auto + manual both read/flip it).
 * @param waitingXlm  live "waiting" total from the drip (splittable + collectable
 *                 + streamed-but-unreceived), in XLM.
 * @param payTo    where collected XLM lands (the kid's own wallet).
 * @param enabled  gate the whole behavior (e.g. only once a public key exists).
 */
export function useAutoScoop({
  collect,
  waitingXlm,
  payTo,
  enabled = true,
}: {
  collect: CollectMutation;
  waitingXlm: number;
  payTo: string | undefined;
  enabled?: boolean;
}): AutoScoopState {
  const [justScooped, setJustScooped] = useState(false);
  const [deterministicError, setDeterministicError] = useState<string | null>(null);

  // Wall-clock of the last auto-scoop ATTEMPT (success or fail). Gates the
  // cooldown. A ref, not state, so bumping it never re-renders or re-runs the
  // effect that reads it — the effect keys on `waitingXlm` alone.
  const lastAttemptRef = useRef(0);
  // Guards a single trigger per mount against React 18 double-invoke and against
  // the same poll value firing twice before `isPending` has flipped.
  const inFlightRef = useRef(false);
  // Timer that fades the quiet note; cleared on unmount / re-fire.
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `collect.isPending` is the SHARED guard. Read the freshest value at trigger
  // time via a ref so the callback below never fires against a stale snapshot
  // (e.g. a manual scoop that started this same tick).
  const isPending = collect.isPending;
  const isPendingRef = useRef(isPending);
  isPendingRef.current = isPending;

  const mutate = collect.mutate;

  const clearNoteTimer = () => {
    if (noteTimer.current) {
      clearTimeout(noteTimer.current);
      noteTimer.current = null;
    }
  };

  const fireAutoScoop = useCallback(() => {
    // Re-check the shared guard against the LIVEST value — a manual tap in the
    // same tick may have already started the pipeline.
    if (isPendingRef.current || inFlightRef.current) return;

    inFlightRef.current = true;
    lastAttemptRef.current = Date.now();

    mutate(
      { to: payTo },
      {
        onSuccess: () => {
          inFlightRef.current = false;
          setDeterministicError(null);
          // Quiet, brief acknowledgement — the real count-up comes for free from
          // the raised balance. No confetti (that stays on reward claims).
          clearNoteTimer();
          setJustScooped(true);
          noteTimer.current = setTimeout(() => setJustScooped(false), AUTO_SCOOP_NOTE_MS);
        },
        onError: (err) => {
          inFlightRef.current = false;
          const { transient, kidMessage } = classifyTxError(err, "collect");
          // Transient → say nothing; the next cooldown tick retries on its own
          // (no nagging). Deterministic → surface one honest, kid-safe line.
          setDeterministicError(transient ? null : kidMessage);
        },
      },
    );
  }, [mutate, payTo]);

  useEffect(() => {
    if (!enabled || !payTo) return;

    // Every gate must hold. Any false → do nothing this tick (silently).
    const enough = waitingXlm >= AUTO_SCOOP_MIN_XLM;
    const cooled = Date.now() - lastAttemptRef.current >= AUTO_SCOOP_COOLDOWN_MS;
    const idle = !isPendingRef.current && !inFlightRef.current;
    const visible =
      typeof document === "undefined" || document.visibilityState === "visible";

    if (enough && cooled && idle && visible) {
      fireAutoScoop();
    }
    // Keyed on the live waiting number: each poll/tick re-evaluates the gates.
    // (isPending/cooldown/visibility are read via refs at check time, so they
    // don't need to be deps — this effect intentionally reacts to `waitingXlm`.)
  }, [waitingXlm, enabled, payTo, fireAutoScoop]);

  useEffect(() => clearNoteTimer, []);

  return { justScooped, deterministicError };
}
