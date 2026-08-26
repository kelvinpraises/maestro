// Pure stream math — a faithful port of apps/contracts/drips floor semantics so
// UI previews match the contract exactly. BigInt everywhere (Cairo u256).
//
// Contract facts being mirrored (drips.cairo):
//   accrued_impl(t)   = 0 if inactive; frozen at pause-time; t>=end ⇒ deposited;
//                       else min(floor((t-start)·rate), deposited)
//   entitlement_i     = floor(accrued_total · share_i / WPS),  WPS = Σ shares
//   claimable_i       = entitlement_i − claimed_i
//   dust              = deposit − Σ floors, swept by last settled claimer after dry-out

export interface StreamParams {
  start: bigint // unix seconds
  end: bigint
  ratePerSec: bigint
  deposited: bigint
}

export function accruedTotal(p: StreamParams, now: bigint): bigint {
  if (now >= p.end) return p.deposited
  if (now <= p.start) return 0n
  const elapsed = now - p.start
  const accrued = elapsed * p.ratePerSec
  return accrued > p.deposited ? p.deposited : accrued
}

/** floor(accrued · share / WPS) — Cairo integer division. */
export function entitlement(accrued: bigint, share: bigint, wps: bigint): bigint {
  return (accrued * share) / wps
}

/** What recipient i can still scoop right now. */
export function claimable(entitlementNow: bigint, claimedSoFar: bigint): bigint {
  const c = entitlementNow - claimedSoFar
  return c > 0n ? c : 0n
}

/**
 * Preview per recipient while the stream runs. Once dry (t ≥ end), each
 * recipient's final take is floor(deposited·share/WPS); the leftover dust is
 * swept by the last settled claimer — shown here as "sweep" on whichever
 * recipient settles last (the UI can't know which in advance).
 */
export function preview(
  p: StreamParams,
  recipients: Array<{ share: bigint }>,
  now: bigint,
): Array<{ entitlement: bigint; sweep?: bigint }> {
  const wps = recipients.reduce((s, r) => s + r.share, 0n)
  const dry = now >= p.end
  const total = accruedTotal(p, now)
  let assigned = 0n
  const out: Array<{ entitlement: bigint; sweep?: bigint }> = recipients.map((r) => {
    const e = entitlement(total, r.share, wps)
    assigned += e
    return { entitlement: e }
  })
  if (dry) {
    const dust = p.deposited - assigned
    if (dust > 0n) out[out.length - 1]!.sweep = dust // last settled sweeps
  }
  return out
}
