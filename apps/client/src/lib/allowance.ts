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
import { StrKey } from "@stellar/stellar-sdk";

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

// ── multi-receiver ordering (must match the contract or set_streams panics) ──
//
// `streams.rs::build_configs` REQUIRES `new_receivers` to be strictly sorted and
// deduped by `receiver_lt`: account ascending, then config (stream_id,
// amt_per_sec, start, duration). Two facts make a naive JS sort wrong:
//
//   1. The account key is a Soroban `Address`, ordered by its RAW 32-byte
//      ed25519 public key — NOT the base32 "G…" string. A lexicographic sort of
//      the G-strings disagrees with the byte order ~8% of the time, which would
//      trip "streams receivers not sorted/deduped" on-chain. So we compare the
//      decoded ed25519 bytes. (For account addresses the ScAddress XDR
//      discriminant is identical across all of them, so byte order == Address
//      order — verified against the SDK's own XDR encoder.)
//   2. The sort must be STRICT (no equal-adjacent receivers), because the
//      contract rejects a non-strict list. We drop exact duplicates.

/** Lexicographic comparison of two accounts' raw ed25519 key bytes (Address order). */
function accountBytesCmp(a: string, b: string): number {
  const A = StrKey.decodeEd25519PublicKey(a);
  const B = StrKey.decodeEd25519PublicKey(b);
  for (let i = 0; i < A.length; i++) {
    if (A[i] !== B[i]) return A[i] - B[i];
  }
  return 0;
}

/** `config_lt` mirror: stream_id, then amt_per_sec, then start, then duration. */
function configCmp(a: StreamReceiver["config"], b: StreamReceiver["config"]): number {
  if (a.stream_id !== b.stream_id) return a.stream_id < b.stream_id ? -1 : 1;
  if (a.amt_per_sec !== b.amt_per_sec) return a.amt_per_sec < b.amt_per_sec ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  if (a.duration !== b.duration) return a.duration < b.duration ? -1 : 1;
  return 0;
}

/** Full `receiver_lt` mirror: by account (raw key bytes), then by config. */
export function receiverCmp(a: StreamReceiver, b: StreamReceiver): number {
  const byAccount = accountBytesCmp(a.account, b.account);
  if (byAccount !== 0) return byAccount;
  return configCmp(a.config, b.config);
}

/**
 * Sort receivers into the strict order `set_streams` requires (account bytes,
 * then config) and drop exact duplicates. Passing the result as `new_receivers`
 * keeps the contract's `build_configs` sort/dedup check happy. Returns a fresh
 * array; the input is not mutated.
 */
export function sortReceivers(receivers: StreamReceiver[]): StreamReceiver[] {
  const sorted = [...receivers].sort(receiverCmp);
  const out: StreamReceiver[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    // Skip an exact duplicate (same account + identical config) — a non-strict
    // pair would make the contract reject the whole list.
    if (prev && receiverCmp(prev, r) === 0) continue;
    out.push(r);
  }
  return out;
}
