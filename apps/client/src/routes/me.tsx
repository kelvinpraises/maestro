// /me — the Me tab. Ported slot from redacted; content per our invariants:
// connected wallet (I5), family recovery code (I2), burner inbox manager (I4),
// dev links when flagged.
import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { WalletIcon, KeyIcon, ArrowClockwiseIcon, LockIcon, GiftIcon } from '@phosphor-icons/react'
import { useWallet } from '#/lib/walletStore'
import { useBoard } from '#/lib/useBoard'
import { currentRole, setRole } from '#/lib/family'
import { mintBurner, exportBurner, importBurner } from '#/lib/burners'
import { IconTile } from '@/components/atoms/icon-tile'
import { Button } from '@/components/atoms/button'
import { toast } from '#/lib/toast'
import { WalletButton } from '@/components/WalletButton'
import { chainName } from '#/lib/starknet'

export const Route = createFileRoute('/me')({ component: Me })

const BKEY = 'maestro.allowanceBurner'

function Me() {
  const navigate = useNavigate()
  const { account, chainId } = useWallet()
  const { board, mutate } = useBoard()
  const [showCode, setShowCode] = useState(false)
  const [code, setCode] = useState('')

  const famId = typeof window !== 'undefined' ? localStorage.getItem('maestro.board.familyId') : null
  const famKey = typeof window !== 'undefined' ? localStorage.getItem('maestro.board.familyKey') : null
  const me = board?.members?.find((m) => m.role === 'kid' && m.address === account?.address)
  const burner = (() => {
    try { const c = localStorage.getItem(BKEY); return c ? importBurner(c) : null } catch { return null }
  })()

  function newInbox() {
    const b = mintBurner()
    localStorage.setItem(BKEY, exportBurner(b))
    void mutate((bd) => {
      const m = bd.members?.find((mm) => mm.role === 'kid' && mm.address === account?.address)
      if (m) m.allowanceInbox = b.address
    })
    toast('New allowance inbox minted ✓')
  }

  function rotateNow() {
    localStorage.removeItem(BKEY)
    newInbox()
  }

  return (
    <div className="stagger-rise space-y-4">
      <header className="flex items-center gap-3">
        <IconTile icon={WalletIcon} tint="butter" size="lg" bordered />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-extrabold">{currentRole() === 'kid' ? (me?.name || 'Kid') : (board?.familyName || 'Parent')}</h1>
          <p className="truncate text-sm font-semibold opacity-60">{account ? `${account.address.slice(0, 10)}… on ${chainId ? chainName(chainId) : '—'}` : 'No wallet connected'}</p>
        </div>
      </header>

      {/* Wallet */}
      <section className="card-pop space-y-2 p-4">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <WalletIcon className="size-4 text-[var(--m-blue)]" weight="duotone" /> Wallet
        </h2>
        <WalletButton />
        <WalletButton />
        <p className="text-[13px] font-bold opacity-70 text-pretty">
          {account
            ? 'Money moves are signed by this wallet. Nobody sees your shielded notes but you.'
            : 'Connect a wallet to claim rewards, scoops, and payouts. Family chores and the board work without one.'}
        </p>
      </section>

      {/* Recovery code — parent gate */}
      {currentRole() === 'parent' && (
        <section className="card-pop card-pop-butter space-y-2 p-4">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <KeyIcon className="size-4" weight="duotone" style={{ color: 'oklch(0.55 0.12 78)' }} /> Family recovery code
          </h2>
          {showCode && code ? (
            <>
              <code className="block break-all rounded-xl border-2 border-[var(--m-ink)] bg-white p-2 text-xs">{code}</code>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { void navigator.clipboard.writeText(code).then(() => toast('Copied ✓')) }}>Copy</Button>
                <Button size="sm" variant="outline" onClick={() => setShowCode(false)}>Hide</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] font-bold opacity-70 text-pretty">The only way back into this family board. Show it privately.</p>
              <Button size="sm" onClick={() => { if (famId && famKey) { import('#/lib/onboarding').then(({ exportRecovery }) => { setCode(exportRecovery(famId, famKey)); setShowCode(true) }) } else toast('No family on this device yet', 'error') }}>
                Show code
              </Button>
            </>
          )}
        </section>
      )}

      {/* Burner inbox manager — kid (I4) */}
      {currentRole() === 'kid' && (
        <section className="card-pop space-y-2 p-4">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <GiftIcon className="size-4 text-[var(--m-green-ink)]" weight="duotone" /> Allowance inbox
          </h2>
          {burner && !('error' in burner) ? (
            <>
              <p className="text-[13px] font-bold opacity-70 text-pretty">
                Live at <code className="text-[11px]">{burner.address.slice(0, 12)}…</code> — your stream drips here. Collect from Stash, then it rotates.
              </p>
              <Button size="sm" onClick={rotateNow}><ArrowClockwiseIcon className="mr-1 size-4" weight="bold" /> Rotate now</Button>
            </>
          ) : (
            <>
              <p className="text-[13px] font-bold opacity-70 text-pretty">No inbox yet. Mint a disposable address so your allowance has somewhere private to land.</p>
              <Button size="sm" onClick={newInbox}>Mint inbox</Button>
            </>
          )}
        </section>
      )}

      {/* Privacy note — the invariant, stated plainly */}
      <section className="card-pop card-pop-sky space-y-1 p-4">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-extrabold">
          <LockIcon className="size-4" weight="duotone" style={{ color: 'var(--m-blue)' }} /> What's private
        </h2>
        <p className="text-[12px] font-bold opacity-70 text-pretty">
          Reward payments and allowance collections move through the STRK20 pool as encrypted notes. The chain can't tell which kid got paid.
        </p>
      </section>

      {/* Demo parity helper: role switch (dev affordance, harmless) */}
      {import.meta.env.VITE_ENABLE_DEV_MONEY === '1' && (
        <section className="card-pop space-y-2 p-4">
          <h2 className="flex items-center gap-1.5 font-display text-sm font-extrabold">
            <LockIcon className="size-4 opacity-50" weight="bold" /> Demo controls
          </h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setRole('parent'); void navigate({ to: '/dashboard' }) }}>View as parent</Button>
            <Button size="sm" variant="outline" onClick={() => { setRole('kid'); void navigate({ to: '/dashboard' }) }}>View as kid</Button>
          </div>
        </section>
      )}
    </div>
  )
}
