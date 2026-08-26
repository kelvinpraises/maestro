// Runnable check: node src/lib/goal-logic.test.ts
import assert from 'node:assert'
import { touchStreak, streakFor, progressFraction, addGoal, utcDay } from './goal-logic.ts'
import { EMPTY_BOARD, type Board } from './board.ts'

function fresh(): Board {
  return JSON.parse(JSON.stringify(EMPTY_BOARD))
}

const DAY = 86_400_000

// ── streaks ──────────────────────────────────────────────────────────────────
{
  const b = fresh()
  const kid = '0xkid1'

  // first check-in starts at 1
  const s = touchStreak(b, kid, '2026-08-20')
  assert.equal(s.count, 1)
  assert.equal(s.lastDay, '2026-08-20')

  // same day again → idempotent, no double-count (two devices, one board)
  const again = touchStreak(b, kid, '2026-08-20')
  assert.equal(again.count, 1)

  // next UTC day → increments; crossing local midnight is irrelevant — UTC rules
  assert.equal(touchStreak(b, kid, '2026-08-21').count, 2)
  assert.equal(touchStreak(b, kid, '2026-08-22').count, 3)

  // gap of >1 day resets to 1
  assert.equal(touchStreak(b, kid, '2026-08-25').count, 1)

  // multiple kids tracked independently
  assert.equal(touchStreak(b, '0xkid2', '2026-08-25').count, 1)
  assert.equal(b.streaks!.find((st) => st.kidAddress === '0xkid1')!.count, 1)
}

// live streak display: alive for today or yesterday, broken otherwise
{
  const b = fresh()
  const today = utcDay()
  touchStreak(b, '0xa', today) // count 1 today
  touchStreak(b, '0xb', utcDay(Date.now() - DAY)) // checked in yesterday only
  const c = fresh()
  touchStreak(c, '0xc', utcDay(Date.now() - 2 * DAY)) // stale two days ago
  assert.equal(streakFor(b, '0xa'), 1)
  assert.equal(streakFor(b, '0xb'), 1) // yesterday's streak still shows until day ends
  assert.equal(streakFor(c, '0xc'), 0) // missed a day → broken (shows 0 until re-check-in)
}

// ── progress ────────────────────────────────────────────────────────────────
assert.equal(progressFraction(100n, 50n), 0.5)
assert.equal(progressFraction(100n, 150n), 1) // clamped
assert.equal(progressFraction(0n, 999n), 0) // empty target
assert.equal(progressFraction(10n ** 18n, 5n * 10n ** 17n), 0.5)

// ── goals ───────────────────────────────────────────────────────────────────
{
  const b = fresh()
  const g = addGoal(b, '0xkid1', 'bike', (5n * 10n ** 18n).toString())
  assert.equal(g.title, 'bike')
  assert.equal(b.goals!.length, 1)
  // second kid's goal coexists
  addGoal(b, '0xkid2', 'lego', '1')
  assert.equal(b.goals!.length, 2)
  assert.equal(new Date(g.createdAt).getTime() <= Date.now(), true)
}

console.log('goal-logic.test: all assertions passed')
