import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { WalletAccountV6 } from 'starknet'
import { useBoard } from '#/lib/useBoard'
import { toast } from '#/lib/toast'
import { useWallet } from '#/lib/walletStore'
import { currentRole, setRole } from '#/lib/family'
import { touchStreak, streakFor, progressFraction, addGoal, utcDay } from '#/lib/goal-logic'
import { totalBalance } from '#/lib/drips'
import { strkToken, chainName } from '#/lib/starknet'

export const Route = createFileRoute('/goals')({ component: Goals })

const STRK = 10n ** 18n
function fmtFelt(felt: string): string {
  try {
    return `${Number((BigInt(felt) * 1000n) / STRK) / 1000}`
  } catch {
    return '?'
  }
}

function Goals() {
  const { board, mutate, syncing, error } = useBoard()
  const { account, chainId } = useWallet()
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('5')
  const [balance, setBalance] = useState<bigint | null>(null)
  const log = (l: string) => toast(l)

  // Board sync failures surface as toasts, not inline blocks.
  useEffect(() => {
    if (error) toast(error, 'error')
  }, [error])

  // Real balance climbing: public STRK + shielded pool balance.
  useEffect(() => {
    if (!account || !chainId) return
    const token = strkToken(chainId)
    if (!token) return
    let cancelled = false
    void totalBalance(account as WalletAccountV6, chainId, token)
      .then((b) => !cancelled && setBalance(b))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [account, chainId])

  function checkIn() {
    void mutate((b) => touchStreak(b, account!.address))
      .then((next) => {
        const mine = next.streaks?.find((s) => s.kidAddress === account!.address)
        log(`checked in ${utcDay()} — streak ${mine?.count ?? 1} 🔥`)
      })
      .catch(() => {})
  }

  function createGoal() {
    if (!account) return
    if (!title.trim()) return
    void mutate((b) => addGoal(b, account.address, title.trim(), (BigInt(parseFloat(target || '0') * 1000) * (STRK / 1000n)).toString()))
      .then(() => {
        log(`goal set: ${title.trim()} for ${target} STRK`)
        setTitle('')
      })
      .catch(() => {})
  }

  if (currentRole() !== 'kid') {
    return (
      <div className="space-y-4 py-2">
        <h1 className="text-2xl font-extrabold">Goals</h1>
        <p className="text-sm">
          Parent view is read-only.{' '}
          <button className="underline" onClick={() => setRole('kid')}>
            Switch to kid
          </button>
        </p>
        <GoalList board={board} />
      </div>
    )
  }

  const streak = streakFor(board, account?.address ?? '')

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-extrabold">Goals</h1>

      <section className="card-pop flex items-center justify-between" style={{ background: 'var(--m-gold)' }}>
        <div>
          <p className="font-extrabold">Daily check-in</p>
          <p className="text-xs font-semibold opacity-70">show up every day (UTC days count)</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-extrabold">{streak}🔥</p>
          <button onClick={checkIn} disabled={syncing || !account} className="btn-pop mt-1 text-sm">
            I'm here!
          </button>
        </div>
      </section>


      {balance !== null && (
        <p className="text-sm font-bold">
          Your money right now: {fmtFelt(balance.toString())} STRK
          {chainId ? ` on ${chainName(chainId)}` : ''}
        </p>
      )}

      <GoalList board={board} kidAddress={account?.address} balance={balance} />

      <section className="card-pop space-y-2">
        <h2 className="label">New goal</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Saving up for…"
          className="w-full rounded-xl border-2 border-[var(--m-ink)] px-3 py-2"
        />
        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            className="w-20 rounded-xl border-2 border-[var(--m-ink)] px-3 py-2"
          />
          <span className="self-center text-sm font-bold">STRK</span>
          <button onClick={createGoal} disabled={syncing || !account} className="btn-pop ml-auto">
            Set goal
          </button>
        </div>
      </section>
    </div>
  )
}

function GoalList({ board, kidAddress, balance }: { board: ReturnType<typeof useBoard>['board']; kidAddress?: string; balance?: bigint | null }) {
  const goals = kidAddress ? (board?.goals?.filter((g) => g.kidAddress === kidAddress) ?? []) : (board?.goals ?? [])
  if (goals.length === 0) return <p className="text-sm opacity-60">No goals yet.</p>
  return (
    <section className="space-y-2">
      <h2 className="label">Savings goals</h2>
      {goals.map((g) => {
        const frac = balance != null && balance !== undefined ? progressFraction(BigInt(g.targetAmount), balance) : 0
        const reached = frac >= 1
        return (
          <div key={g.createdAt + g.title} className="card-pop space-y-1" style={reached ? { background: 'var(--m-green)' } : undefined}>
            <div className="flex items-center justify-between">
              <span className="font-bold">{reached ? '🎉 ' : ''}{g.title}</span>
              <span className="text-xs font-extrabold">
                {fmtFelt(balance?.toString() ?? '0')} / {fmtFelt(g.targetAmount)} STRK
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full border-2 border-[var(--m-ink)] bg-white">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(frac * 100)}%`, background: reached ? 'var(--m-gold)' : 'var(--m-green)' }}
              />
            </div>
          </div>
        )
      })}
    </section>
  )
}
