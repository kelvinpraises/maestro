// allowance.ts — pure (no-React) data-layer helpers for the Maestro allowance
// engine, which is the `drips` streaming contract on Stellar testnet.
//
// The drips contract streams a token at `amt_per_sec`, a FIXED-POINT rate: the
// real per-second stroop rate is multiplied by `AMT_PER_SEC_MULTIPLIER` so that
// sub-stroop-per-second rates stay exact (mirrors `AMT_PER_SEC_MULTIPLIER` in
// `contracts/drips/src/streams.rs` and the Rust test `allowance_stream_end_to_end`).
//
// The engine runs 2-second cycles (`cycle_secs = 2` on the deployed contract).
// Because a transaction is simulated then submitted, any storage footprint
// derived from "now" can shift between the two steps. So we ALWAYS pin an
// explicit future `start` (cycle-aligned) and an explicit `duration` when
// creating an allowance, and pass a bounded `max_cycles` when receiving —
// never the open-ended 0 / "all" defaults.

import type { StreamReceiver } from "drips";

/** 1 XLM = 10^7 stroops (the i128 base unit the contract moves). */
export const XLM_STROOPS = 10_000_000n;

/**
 * Fixed-point multiplier the contract applies to `amt_per_sec`. To stream `R`
 * stroops per second, set `amt_per_sec = R * AMT_PER_SEC_MULTIPLIER`.
 * Must equal `AMT_PER_SEC_MULTIPLIER` in `contracts/drips/src/streams.rs`.
 */
export const AMT_PER_SEC_MULTIPLIER = 1_000_000_000n;

/** Deployed cycle length (seconds). The contract is init'd with `cycle_secs = 2`. */
export const CYCLE_SECS = 2;

/** Cap on cycles pulled in a single `receive_streams` call (keeps footprint bounded). */
export const MAX_RECEIVE_CYCLES = 50;

const SECONDS_PER_MINUTE = 60n;
const SECONDS_PER_HOUR = 3_600n;
const SECONDS_PER_DAY = 86_400n;
const SECONDS_PER_WEEK = 604_800n;

export type AllowancePeriod = "minute" | "hour" | "day" | "week";

/** Seconds in each allowance period — the divisor turning a rate into per-second. */
const PERIOD_SECS: Record<AllowancePeriod, bigint> = {
  minute: SECONDS_PER_MINUTE,
  hour: SECONDS_PER_HOUR,
  day: SECONDS_PER_DAY,
  week: SECONDS_PER_WEEK,
};

/**
 * Convert a human allowance rate (XLM per minute / hour / day / week) into the
 * contract's fixed-point `amt_per_sec`. Integer math throughout — no float
 * rounding.
 *
 * `amt_per_sec = (xlm * XLM_STROOPS / periodSecs) * AMT_PER_SEC_MULTIPLIER`
 * kept as one fraction so the multiplier absorbs the per-second remainder.
 *
 * The multiplier carries 1e9 of extra precision, so even a fast, small
 * per-minute rate (e.g. 0.01 XLM/min = 100_000 stroops over 60s) stays a
 * positive `amt_per_sec` and does not round to 0 stroops/sec.
 */
export function amtPerSecFromRate(xlmPerPeriod: number, period: AllowancePeriod): bigint {
  const periodSecs = PERIOD_SECS[period];
  // XLM → whole stroops (7 decimals), then fixed-point per-second rate. Keeping
  // the multiplier in the numerator lets it absorb the per-second remainder.
  const stroops = xlmToStroops(xlmPerPeriod);
  return (stroops * AMT_PER_SEC_MULTIPLIER) / periodSecs;
}

/** Whole stroops streamed per second for a fixed-point `amt_per_sec`. */
export function stroopsPerSec(amtPerSec: bigint): bigint {
  return amtPerSec / AMT_PER_SEC_MULTIPLIER;
}

/** Whole stroops streamed over one cycle. */
export function ratePerCycle(amtPerSec: bigint, cycleSecs: number = CYCLE_SECS): bigint {
  return (amtPerSec * BigInt(cycleSecs)) / AMT_PER_SEC_MULTIPLIER;
}

/** Convert a stroop amount to a display XLM number. */
export function stroopsToXlm(stroops: bigint): number {
  return Number(stroops) / Number(XLM_STROOPS);
}

/** Convert an XLM amount (number) to whole stroops (bigint). */
export function xlmToStroops(xlm: number): bigint {
  return BigInt(Math.round(xlm * Number(XLM_STROOPS)));
}

/**
 * A future start timestamp rounded UP to the next cycle boundary, at least
 * `leadSecs` seconds ahead of `nowSecs`. Cycle-aligning the start keeps the
 * per-cycle delta accounting clean across the simulate/submit gap.
 */
export function cycleAlignedStart(
  nowSecs: number,
  cycleSecs: number = CYCLE_SECS,
  leadSecs = 12,
): number {
  const target = nowSecs + leadSecs;
  return Math.ceil(target / cycleSecs) * cycleSecs;
}

/**
 * Bounded `max_cycles` for a `receive_streams` call: ceil(elapsed / cycleSecs)
 * clamped to [1, MAX_RECEIVE_CYCLES]. Never pass "all".
 */
export function maxCyclesForElapsed(
  elapsedSecs: number,
  cycleSecs: number = CYCLE_SECS,
): number {
  const cycles = Math.ceil(Math.max(0, elapsedSecs) / cycleSecs);
  return Math.min(MAX_RECEIVE_CYCLES, Math.max(1, cycles));
}

/**
 * Build a single `StreamReceiver` for an allowance with an explicit,
 * cycle-aligned future `start` and explicit `duration` (never 0/open-ended).
 */
export function buildAllowanceReceiver(params: {
  account: string;
  amtPerSec: bigint;
  start: bigint;
  duration: bigint;
  streamId?: bigint;
}): StreamReceiver {
  return {
    account: params.account,
    config: {
      stream_id: params.streamId ?? 0n,
      amt_per_sec: params.amtPerSec,
      start: params.start,
      duration: params.duration,
    },
  };
}

/** Total stroops a stream will move over its whole `duration`. */
export function totalOverDuration(amtPerSec: bigint, durationSecs: bigint): bigint {
  return (amtPerSec * durationSecs) / AMT_PER_SEC_MULTIPLIER;
}
