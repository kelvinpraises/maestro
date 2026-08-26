import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { WalletAccountV6 } from 'starknet'
import { useBoard } from '#/lib/useBoard'
import { useWallet } from '#/lib/walletStore'
import { currentRole, setRole } from '#/lib/family'
import { shieldedBalances, privateTransfer } from '#/lib/strk20'
import { strkToken, chainName } from '#/lib/starknet'
import { startApproval, markPaid, revertToPending } from '#/lib/chore-logic'

export const Route = createFileRoute('/pot')({ component: Pot })

const STRK = 10n ** 18n
function fmtReward(felt: string): string {
  try {
    return `${Number((BigInt(felt) * 100n) / STRK) / 100} STRK`
  } catch {
    return '? STRK'
  }
}

function Pot() {
  const { board, mutate, syncing, error } = useBoard()
  const { account, chainId } = useWallet()
  const [title, setTitle] = useState('')
  const [reward, setReward] = useState('1')
  const [out, setOut] = useState('')
  const log = (l: string) => setOut((o) => `${o}\n${l}`)

  if (currentRole() !== 'parent') {
    return (
      <p className="p-4 text-sm">
        This is the parent screen.{' '}
        <button className="underline" onClick={() => setRole('parent')}>
          Switch to parent
        </button>
      </p>
    )
  }

  function postChore() {
    if (!title.trim()) return
    void mutate((b) => {
      b.chores.push({
        id: crypto.randomUUID(),
        title: title.trim(),
        reward: BigInt(reward || '0') * STRK + '',
        state: 'todo',
      })
    })
      .then(() => {
        log(`chore posted: ${title.trim()} (${reward} STRK)`)
        setTitle('')
      })
      .catch(() => {})
  }

  /**
   * Two-phase payout so a failed transfer can never strand "approved-but-unpaid":
   *   save 'paying' → pre-flight balance → private transfer → save hash+'approved'.
   * Transfer failure reverts to 'pending' (retryable, no double-pay risk).
   */
  async function approve(choreId: string) {
    if (!board || !account || !chainId) {
      log('ERROR: connect the parent wallet first.')
      return
    }
    const chore = board.chores.find((c) => c.id === choreId)!
    const kid = board.members?.find((m) => m.role === 'kid')
    if (!kid) {
      log('ERROR: no kid registered yet — the kid must join from their device first.')
      return
    }
    const token = strkToken(chainId)
    if (!token) {
      log(`ERROR: no STRK token address configured for ${chainName(chainId)}.`)
      return
    }

    await mutate((b) => startApproval(b, choreId))
    log(`approving "${chore.title}" → paying ${fmtReward(chore.reward)} to ${kid.name}…`)

    try {
      // Pre-flight: shielded pot must cover it (one consent-gated wallet read).
      const balances = await shieldedBalances(account as WalletAccountV6)
      const held = balances.find((b) => b.token.toLowerCase() === token.toLowerCase())
      if (!held || BigInt(held.balance) < BigInt(chore.reward)) {
        throw new Error(`insufficient shielded balance${held ? ` (have ${fmtReward(held.balance)})` : ''}`)
      }

      const r = await privateTransfer(account as WalletAccountV6, chainId, token, chore.reward, kid.address)
      log(`transfer ${r.status}: ${r.hash}`)

      await mutate((b) => markPaid(b, choreId, r.hash))
      log('approved ✓')
    } catch (e) {
      log(`ERROR: ${e instanceof Error ? e.message : String(e)} — reverted to pending`)
      await mutate((b) => revertToPending(b, choreId)).catch(() => {})
    }
  }

  const needsNod = board?.chores.filter((c) => c.state === 'pending') ?? []
  const rest = board?.chores.filter((c) => c.state !== 'pending' && c.state !== 'paying') ?? []
  const paying = board?.chores.find((c) => c.state === 'paying')

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-extrabold">Pot</h1>

      {(error || out.trim()) && (
        <pre className="card-pop whitespace-pre-wrap !p-3 text-xs text-red-600">{error ?? out}</pre>
      )}

      <section className="card-pop space-y-2">
        <h2 className="font-extrabold">Post a chore</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          className="w-full rounded-xl border-2 border-[var(--m-ink)] px-3 py-2"
        />
        <div className="flex gap-2">
          <input
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            inputMode="decimal"
            className="w-20 rounded-xl border-2 border-[var(--m-ink)] px-3 py-2"
          />
          <span className="self-center text-sm font-bold">STRK</span>
          <button onClick={postChore} disabled={syncing} className="btn-pop ml-auto">
            Post
          </button>
        </div>
      </section>

      {needsNod.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-extrabold">Needs your nod</h2>
          {needsNod.map((c) => (
            <div key={c.id} className="card-pop flex items-center justify-between" style={{ background: 'var(--m-gold)' }}>
              <div>
                <p className="font-bold">{c.title}</p>
                <p className="text-xs font-semibold">{fmtReward(c.reward)} — kid did it!</p>
              </div>
              <button onClick={() => void approve(c.id)} disabled={syncing} className="btn-pop">
                Approve & pay
              </button>
            </div>
          ))}
        </section>
      )}

      {paying && (
        <div className="card-pop text-sm font-bold" style={{ background: 'var(--m-pink)' }}>
          Paying “{paying.title}”…
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-extrabold">Chores</h2>
        {rest.length === 0 && <p className="text-sm opacity-60">No chores yet.</p>}
        {rest.map((c) => (
          <div key={c.id} className="card-pop flex items-center justify-between">
            <span className="font-bold">{c.title}</span>
            <span
              className="rounded-full border-2 border-[var(--m-ink)] px-2 py-0.5 text-xs font-extrabold"
              style={{ background: c.state === 'approved' ? 'var(--m-green)' : 'var(--m-lavender)' }}
            >
              {c.state === 'approved' ? `paid ✓` : fmtReward(c.reward)}
            </span>
          </div>
        ))}
      </section>
    </div>
  )
}
