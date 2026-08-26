// Runnable check: node src/lib/chore-logic.test.ts
import assert from 'node:assert'
import { claimChore, startApproval, markPaid, revertToPending } from './chore-logic.ts'
import { EMPTY_BOARD, type Board, type Chore } from './board.ts'

function boardWith(state: Chore['state']): Board {
  const b: Board = JSON.parse(JSON.stringify(EMPTY_BOARD))
  b.members = []
  b.chores.push({ id: 'c1', title: 'dishes', reward: '0x2386f26fc10000', state })
  return b
}

// todo → pending → paying → approved, the happy path
{
  const b = boardWith('todo')
  claimChore(b, 'c1')
  assert.equal(b.chores[0]!.state, 'pending')
  startApproval(b, 'c1')
  assert.equal(b.chores[0]!.state, 'paying')
  markPaid(b, 'c1', '0xtx')
  assert.equal(b.chores[0]!.state, 'approved')
  assert.equal(b.approvals.length, 1)
  assert.equal(b.approvals[0]!.choreId, 'c1')
  assert.equal(b.approvals[0]!.txHash, '0xtx')
}

// double approval impossible: approve again after paid throws
{
  const b = boardWith('approved')
  assert.throws(() => startApproval(b, 'c1'), /cannot approve/)
}

// illegal transitions all throw and leave state untouched
for (const [from, op] of [
  ['todo', startApproval], // can't approve an unclaimed chore
  ['paying', claimChore], // can't re-claim mid-payout
  ['approved', claimChore], // can't re-claim a paid chore
  ['todo', revertToPending], // revert only valid from paying
] as const) {
  const b = boardWith(from)
  assert.throws(() => op(b, 'c1'), new RegExp(`state '${from}'`))
  assert.equal(b.chores[0]!.state, from) // unchanged
}

// failed payout reverts to pending, retryable
{
  const b = boardWith('paying')
  revertToPending(b, 'c1')
  assert.equal(b.chores[0]!.state, 'pending')
  startApproval(b, 'c1') // retry works
  assert.equal(b.chores[0]!.state, 'paying')
}

// vanished chore (deleted by another device) → visible error
assert.throws(() => claimChore(boardWith('todo'), 'ghost'), /no longer exists/)

console.log('chore-logic.test: all assertions passed')
