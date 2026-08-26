// Runnable check: node src/lib/stream-math.test.ts
import assert from 'node:assert'
import { accruedTotal, entitlement, claimable, preview, type StreamParams } from './stream-math.ts'

const base: StreamParams = { start: 1000n, end: 2000n, ratePerSec: 3n, deposited: 10000n }

// mid-stream accrual: floor(elapsed·rate), capped by deposit
assert.equal(accruedTotal(base, 1100n), 300n)
assert.equal(accruedTotal(base, 5000n), 10000n) // past end → whole deposit
assert.equal(accruedTotal(base, 900n), 0n) // not started

// cap kicks in before end when deposit runs out early
assert.equal(accruedTotal({ ...base, ratePerSec: 50n }, 1300n), 10000n)

// paused semantics: caller freezes `now` at pause-time (start + pausedElapsed) —
// mirror by just passing that timestamp.
assert.equal(accruedTotal(base, 1050n), 150n)

// entitlement floors like Cairo u256 division: no rounding up
assert.equal(entitlement(999n, 1n, 3n), 333n)
assert.equal(entitlement(7n, 2n, 3n), 4n)

// claimable never negative
assert.equal(claimable(5n, 5n), 0n)
assert.equal(claimable(9n, 4n), 5n)

// two-kid split preview matches contract doc example:
// amount 10_000 over start..end with rate 3 → mid-stream total 300;
// shares 1:3 → WPS 4 → floors 75 and 225.
{
  const [a, b] = preview(base, [{ share: 1n }, { share: 3n }], 1100n)
  assert.equal(a!.entitlement, 75n)
  assert.equal(b!.entitlement, 225n)
}

// dry stream: totals become floor(deposit·share/WPS); dust to last settled
{
  const p: StreamParams = { start: 1000n, end: 2000n, ratePerSec: 20n, deposited: 100n }
  // shares 1:1:WPS 2 → floors 50+50=100, no dust
  const even = preview(p, [{ share: 1n }, { share: 1n }], 3000n)
  assert.equal(even[0]!.entitlement, 50n)
  assert.equal(even[1]!.entitlement, 50n)
  assert.equal(even[1]!.sweep, undefined)

  // deposit 101, shares 1:2 → floors 33+67=100 → dust 1 sweeps to last settled
  const dusty = preview({ ...p, deposited: 101n }, [{ share: 1n }, { share: 2n }], 3000n)
  assert.equal(dusty[0]!.entitlement, 33n)
  assert.equal(dusty[1]!.entitlement, 67n)
  assert.equal(dusty[1]!.sweep, 1n)
}

console.log('stream-math.test: all assertions passed')
