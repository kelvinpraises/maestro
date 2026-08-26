// Pure goal + streak logic — no React, no SDK. Node-testable.
//
// DAY BOUNDARY POLICY: UTC calendar days (YYYY-MM-DD from Date.toISOString).
// Chosen over local time so two devices in different timezones agree on what
// "yesterday" means; documented trade-off: a kid near a UTC line may count a
// local-midnight-spanning check-in as the same day. One rule, everywhere.
import type { Board, Goal, Streak } from './board'

/** UTC day string for a unix-ms timestamp. */
export function utcDay(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Touch today's streak for a kid. Idempotent within one UTC day; consecutive
 * day increments; a gap > 1 day resets to 1. Mutates board.streaks in place.
 */
export function touchStreak(board: Board, kidAddress: string, today = utcDay()): Streak {
  board.streaks ??= []
  let s = board.streaks.find((st) => st.kidAddress === kidAddress)
  if (!s) {
    s = { kidAddress, lastDay: today, count: 1 }
    board.streaks.push(s)
    return s
  }
  if (s.lastDay === today) return s // already counted today
  const yesterday = utcDay(Date.parse(today) - 86_400_000)
  s.count = s.lastDay === yesterday ? s.count + 1 : 1
  s.lastDay = today
  return s
}

export function streakFor(board: Board | null | undefined, kidAddress: string): number {
  const s = board?.streaks?.find((st) => st.kidAddress === kidAddress)
  if (!s) return 0
  // A streak only "lives" while kept alive: if lastDay is older than
  // yesterday (UTC), it's broken until the next check-in resets it.
  if (s.lastDay !== utcDay() && s.lastDay !== utcDay(Date.now() - 86_400_000)) return 0
  return s.count
}

/** Progress fraction clamped to [0,1]; target ≤ 0 treated as empty goal. */
export function progressFraction(target: bigint, balance: bigint): number {
  if (target <= 0n) return 0
  const pct = (balance * 100n) / target
  return Number(pct > 100n ? 100n : pct) / 100
}

/** Create a goal for this kid. Mutates board.goals in place. */
export function addGoal(board: Board, kidAddress: string, title: string, targetAmount: string): Goal {
  board.goals ??= []
  const g: Goal = { kidAddress, title, targetAmount, createdAt: new Date().toISOString() }
  board.goals.push(g)
  return g
}
