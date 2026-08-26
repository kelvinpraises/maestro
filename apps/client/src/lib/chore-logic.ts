// Pure chore state machine — no React, no SDK. Testable under plain node.
import type { Board, Chore } from './board'

export type ChoreState = 'todo' | 'pending' | 'paying' | 'approved'

export function nextId(): string {
  return crypto.randomUUID()
}

function findChore(board: Board, choreId: string): Chore {
  const c = board.chores.find((c) => c.id === choreId)
  if (!c) throw new Error('chore no longer exists (removed by another device)')
  return c
}

/** Kid claims a todo chore → pending ("I did it!"). */
export function claimChore(board: Board, choreId: string): void {
  const c = findChore(board, choreId)
  if (c.state !== 'todo') throw new Error(`cannot claim chore in state '${c.state}'`)
  c.state = 'pending'
}

/**
 * Parent nods: 'pending' → 'paying'. The payout fires AFTER this save lands;
 * markPaid completes the transition once the private transfer is confirmed.
 * Illegal from any other state — double approval is impossible by construction.
 */
export function startApproval(board: Board, choreId: string): void {
  const c = findChore(board, choreId)
  if (c.state !== 'pending') throw new Error(`cannot approve chore in state '${c.state}'`)
  c.state = 'paying'
}

/** Transfer confirmed on-chain → terminal 'approved' with the tx hash. */
export function markPaid(board: Board, choreId: string, txHash: string): void {
  const c = findChore(board, choreId)
  if (c.state !== 'paying') throw new Error(`cannot complete payout for chore in state '${c.state}'`)
  c.state = 'approved'
  board.approvals.push({ id: nextId(), choreId, at: new Date().toISOString(), txHash })
}

/** Transfer failed → back to 'pending', retryable without double-pay risk. */
export function revertToPending(board: Board, choreId: string): void {
  const c = findChore(board, choreId)
  if (c.state !== 'paying') throw new Error(`cannot revert chore in state '${c.state}'`)
  c.state = 'pending'
}
