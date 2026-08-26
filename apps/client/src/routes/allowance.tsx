import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { WalletAccountV6 } from 'starknet'
import { useBoard } from '#/lib/useBoard'
import { useWallet } from '#/lib/walletStore'
import { currentRole, setRole } from '#/lib/family'
import { openSplit } from '#/lib/drips'
import { dripsAddress, strkToken, chainName } from '#/lib/starknet'

export const Route = createFileRoute('/allowance')({ component: Allowance })

const STRK = 10n ** 18n
function wholeToFelt(v: string): bigint {
  return BigInt(parseFloat(v || '0') * 1000) * (STRK / 1000n)
}

function Allowance() {
  const { board, mutate } = useBoard()
  const { account, chainId } = useWallet()
  const [amount, setAmount] = useState('10')
  const [days, setDays] = useState('30')
  const [shares, setShares] = useState<Record<string, string>>({}) // address → weight
  const [out, setOut] = useState('')
  const log = (l: string) => setOut((o) => `${o}\n${l}`)

  if (currentRole() !== 'parent') {
    return (
      <p className="p-4 text-sm">
        Parent screen.{' '}
        <button className="underline" onClick={() => setRole('parent')}>
          Switch to parent
        </button>
      </p>
    )
  }

  const kids = board?.members?.filter((m) => m.role === 'kid') ?? []

  function openStream() {
    if (!account || !chainId) return log('ERROR: connect the parent wallet first.')
    const drips = dripsAddress(chainId)
    if (!drips) return log(`ERROR: no drips contract deployed/configured for ${chainName(chainId)} (set VITE_DRIPS_ADDRESS_${chainName(chainId).toUpperCase()}).`)
    const token = strkToken(chainId)!

    const recipients = kids
      .map((m) => ({ address: m.address, share: BigInt(shares[m.address] || '1') }))
      .filter((r) => r.share > 0n)
    if (recipients.length === 0) return log('ERROR: pick at least one kid with a positive share.')

    const amt = wholeToFelt(amount)
    const secs = BigInt(parseInt(days || '1')) * 86400n
    // Contract derives duration = amount / rate — invert so the stream lasts ~`days`.
    const rate = amt / secs || 1n

    setOut(`opening split stream: ${amount} STRK over ${days}d → rate ${rate}/s across ${recipients.length} kid(s)…`)
    void openSplit(account as WalletAccountV6, token, drips, recipients, rate, amt)
      .then(async (hash) => {
        log(`stream opened ✓ tx ${hash}`)
        // Mirror weights into the board so kids can compute their own slice.
        await mutate((b) => {
          b.streams ??= []
          b.streams.push({
            id: hash,
            recipients: recipients.map((r) => ({ address: r.address, share: r.share.toString() })),
            amount: amt.toString(),
            ratePerSec: rate.toString(),
            openedAt: new Date().toISOString(),
          })
        })
      })
      .catch((e) => log(`ERROR: ${e instanceof Error ? e.message : String(e)}`))
  }

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-extrabold">Allowance</h1>

      {out.trim() && (
        <pre className="card-pop whitespace-pre-wrap !p-3 text-xs text-red-600">{out}</pre>
      )}

      <section className="card-pop space-y-2">
        <h2 className="label">Open a drip stream</h2>
        {kids.length === 0 && <p className="text-sm opacity-60">No kids registered on the board yet.</p>}
        {kids.map((m) => (
          <label key={m.address} className="flex items-center justify-between gap-2 text-sm font-bold">
            <span className="truncate">{m.name} ({m.address.slice(0, 8)}…)</span>
            <input
              value={shares[m.address] ?? ''}
              onChange={(e) => setShares((s) => ({ ...s, [m.address]: e.target.value }))}
              placeholder="share"
              inputMode="numeric"
              className="w-20 rounded-xl border-2 border-[var(--m-ink)] px-2 py-1"
            />
          </label>
        ))}
        <div className="flex gap-2 pt-1">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-20 rounded-xl border-2 border-[var(--m-ink)] px-3 py-2" />
          <span className="self-center text-sm font-bold">STRK over</span>
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="w-16 rounded-xl border-2 border-[var(--m-ink)] px-3 py-2" />
          <span className="self-center text-sm font-bold">days</span>
          <button onClick={openStream} className="btn-pop ml-auto">Open stream</button>
        </div>
        <p className="text-xs opacity-60">
          Weights set each kid's slice of every drop. The stream pulls public STRK from your wallet (approve + open in one transaction).
        </p>
      </section>
    </div>
  )
}
