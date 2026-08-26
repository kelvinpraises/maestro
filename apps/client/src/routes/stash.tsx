import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { WalletAccountV6 } from 'starknet'
import { useBoard } from '#/lib/useBoard'
import { useWallet } from '#/lib/walletStore'
import { currentRole, setRole } from '#/lib/family'
import { scoop, accruedAt } from '#/lib/drips'
import { providerForChain, dripsAddress, chainName } from '#/lib/starknet'
import { entitlement } from '#/lib/stream-math'

export const Route = createFileRoute('/stash')({ component: Stash })

function fmtFelt18(felt: bigint): string {
  return `${Number((felt * 1000n) / 10n ** 18n) / 1000}`
}

function Stash() {
  const { board } = useBoard()
  const { account, chainId } = useWallet()
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const log = (l: string) => setOut((o) => `${o}\n${l}`)

  if (currentRole() !== 'kid') {
    return (
      <p className="p-4 text-sm">
        Kid screen.{' '}
        <button className="underline" onClick={() => setRole('kid')}>
          Switch to kid
        </button>
      </p>
    )
  }

  async function refreshAccrual() {
    if (!account || !chainId) return log('ERROR: connect your wallet first.')
    const drips = dripsAddress(chainId)
    if (!drips) return log(`ERROR: no drips contract configured for ${chainName(chainId)}.`)
    const stream = board?.streams?.at(-1)
    if (!stream) return log('No allowance stream opened yet.')
    const me = board?.members?.find((m) => m.role === 'kid' && m.address === account.address)
    const mine = stream.recipients.find((r) => r.address.toLowerCase() === account.address.toLowerCase())
    if (!me || !mine) {
      log("You're not part of the current stream — ask a parent to include you.")
      return
    }
    try {
      // Reads route through the wallet's chain — never env's.
      const now = BigInt(Math.floor(Date.now() / 1000))
      // accrued_at folds start/end/rate in on-chain; we only need the total.
      const total = await accruedAt(providerForChain(chainId), drips, now)
      const mySlice = entitlement(total, BigInt(mine.share), stream.recipients.reduce((s, r) => s + BigInt(r.share), 0n))
      log(`stream accrued so far: ${fmtFelt18(total)} STRK`)
      log(`your gross slice since stream start: ${fmtFelt18(mySlice)} STRK`)
      log('(scoop pays everything not yet scooped; paused streams freeze accrual)')
    } catch (e) {
      log(`ERROR: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function doScoop() {
    if (!account || !chainId) return
    const drips = dripsAddress(chainId)
    if (!drips) return log(`ERROR: no drips contract configured for ${chainName(chainId)}.`)
    setBusy(true)
    try {
      const hash = await scoop(account as WalletAccountV6, drips, account.address)
      log(`scooped ✓ tx ${hash} — landed privately in your wallet`)
    } catch (e) {
      log(`ERROR: ${e instanceof Error ? e.message : String(e)}${e instanceof Error && /nothing to claim/.test(e.message) ? ' (nothing accrued to scoop yet)' : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const joined = board?.members?.some((m) => m.role === 'kid' && m.address === account?.address)

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-extrabold">Stash</h1>

      {out.trim() && (
        <pre className="card-pop whitespace-pre-wrap !p-3 text-xs">{out}</pre>
      )}

      <section className="card-pop space-y-2">
        <h2 className="font-extrabold">Your allowance drip</h2>
        {!joined ? (
          <p className="text-sm opacity-60">
            Join the family on the Chores screen first — your reward address is how the stream finds you.
          </p>
        ) : (
          <>
            <p className="text-xs opacity-70">
              Allowance drips every couple of seconds into your private stash. Scooping pulls your slice straight into this wallet.
            </p>
            <div className="flex gap-2">
              <button onClick={() => void refreshAccrual()} disabled={busy} className="rounded-full border-2 border-[var(--m-ink)] px-4 py-1.5 text-sm font-extrabold" style={{ background: 'var(--m-lavender)' }}>
                Check accrual
              </button>
              <button onClick={() => void doScoop()} disabled={busy} className="btn-pop">
                Scoop
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
