import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useBoard } from '#/lib/useBoard'
import { toast } from '#/lib/toast'
import { useWallet } from '#/lib/walletStore'
import { currentRole, setRole } from '#/lib/family'
import { claimChore } from '#/lib/chore-logic'

export const Route = createFileRoute('/chores')({ component: Chores })

function fmtReward(felt: string): string {
  try {
    return `${Number((BigInt(felt) * 100n) / 10n ** 18n) / 100} STRK`
  } catch {
    return '? STRK'
  }
}

function Chores() {
  const { board, mutate, syncing, error } = useBoard()
  const { account } = useWallet()
  const log = (l: string) => toast(l)

  // Board sync failures surface as toasts, not inline blocks.
  useEffect(() => {
    if (error) toast(error, 'error')
  }, [error])

  if (currentRole() !== 'kid') {
    return (
      <p className="p-4 text-sm">
        This is the kid screen.{' '}
        <button className="underline" onClick={() => setRole('kid')}>
          Switch to kid
        </button>
      </p>
    )
  }

  /** Join: register this device's wallet as the kid's reward address on the board. */
  function join() {
    if (!account) {
      log('ERROR: connect your wallet first (header button).')
      return
    }
    void mutate((b) => {
      b.members ??= []
      const me = b.members.find((m) => m.role === 'kid')
      if (me) {
        me.address = account.address // re-join updates the stash address
      } else {
        b.members.push({ name: 'Kid', role: 'kid', address: account.address })
      }
    })
      .then(() => log(`joined! rewards will arrive privately at ${account.address.slice(0, 10)}…`))
      .catch(() => {})
  }

  function didIt(choreId: string) {
    void mutate((b) => claimChore(b, choreId))
      .then(() => log('nice! waiting for a parent nod 💚'))
      .catch(() => {})
  }

  const joined = board?.members?.some((m) => m.role === 'kid' && m.address === account?.address)
  const chores = board?.chores ?? []
  const open = chores.filter((c) => c.state === 'todo')
  const waiting = chores.filter((c) => c.state !== 'todo')

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-extrabold">Chores</h1>


      {!joined && (
        <section className="card-pop space-y-2" style={{ background: 'var(--m-lavender)' }}>
          <p className="text-sm font-bold">Join the family to earn rewards privately.</p>
          <p className="text-xs opacity-70">
            Your reward address is shared with the parent via the encrypted board — only they can see it.
          </p>
          <button onClick={join} disabled={syncing || !account} className="btn-pop">
            {account ? 'Join family' : 'Connect wallet first'}
          </button>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="label">Do these</h2>
        {open.length === 0 && <p className="text-sm opacity-60">Nothing to do right now 🎉</p>}
        {open.map((c) => (
          <div key={c.id} className="card-pop flex items-center justify-between">
            <div>
              <p className="font-bold">{c.title}</p>
              <p className="text-xs font-semibold" style={{ color: 'var(--m-green-ink)' }}>
                earns {fmtReward(c.reward)}
              </p>
            </div>
            <button onClick={() => didIt(c.id)} disabled={syncing} className="btn-pop">
              I did it!
            </button>
          </div>
        ))}
      </section>

      {waiting.length > 0 && (
        <section className="space-y-2">
          <h2 className="label">Waiting on parent</h2>
          {waiting.map((c) => (
            <div key={c.id} className="card-pop flex items-center justify-between opacity-80">
              <span className="font-bold">{c.title}</span>
              <span className="rounded-full border-2 border-[var(--m-ink)] bg-[var(--m-gold)] px-2 py-0.5 text-xs font-extrabold">
                {c.state === 'approved' ? 'paid ✓' : c.state === 'paying' ? 'paying…' : 'waiting'}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
