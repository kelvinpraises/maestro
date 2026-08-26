import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { ensureFamily, importKey } from '#/lib/board'
import { exportRecovery, importRecovery } from '#/lib/onboarding'
import { setRole } from '#/lib/family'
import { toast } from '#/lib/toast'

export const Route = createFileRoute('/welcome')({ component: Welcome })

// First-run flow. Three doors:
//   1. no family yet → mint → show recovery code ONCE → role choice
//   2. parent with existing recovery code → import
//   3. kid → paste family's ID + pick a name → members[] write via board
function Welcome() {
  const [mode, setMode] = useState<'start' | 'show-code' | 'import' | 'kid'>('start')
  const [code, setCode] = useState('')
  const [familyId, setFamilyId] = useState('')
  const [name, setName] = useState('')
  const navigate = useNavigate()

  function begin() {
    const fam = ensureFamily()
    setFamilyId(fam.familyId)
    setCode(exportRecovery(fam.familyId, fam.rawKey))
    setMode('show-code')
  }

  function doImport() {
    const r = importRecovery(code)
    if ('error' in r) {
      toast(r.error, 'error')
      return
    }
    localStorage.setItem('maestro.board.familyId', r.familyId)
    localStorage.setItem('maestro.board.key', r.rawKey)
    setRole('parent')
    toast('Family restored ✓')
    void navigate({ to: '/pot' })
  }

  async function kidJoin() {
    const fam = ensureFamily() // kid device still needs its own key to decrypt
    localStorage.setItem('maestro.board.familyId', familyId.trim() || fam.familyId)
    localStorage.setItem('maestro.board.key', fam.rawKey)
    setRole('kid')
    try {
      // Wallet must be connected to know the reward address.
      const { getWallet } = await import('#/lib/walletStore')
      const { account } = getWallet()
      if (!account) throw new Error('connect your wallet first (header button), then join again')
      const key = await importKey(fam.rawKey)
      const { save } = await import('#/lib/board')
      const { BOARD_URL } = await import('#/lib/env')
      const fid = localStorage.getItem('maestro.board.familyId')!
      await save(BOARD_URL, fid, key, (b) => {
        b.members ??= []
        const me = b.members.find((m) => m.address === account.address)
        if (me) me.name = name.trim() || 'Kid'
        else b.members.push({ name: name.trim() || 'Kid', role: 'kid', address: account.address })
      })
      toast(`Welcome, ${name.trim() || 'Kid'}! ✓`)
      void navigate({ to: '/chores' })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <div className="space-y-4 py-6">
      <h1 className="text-3xl font-extrabold">Maestro 🎹</h1>

      {mode === 'start' && (
        <section className="card-pop space-y-3">
          <p className="text-sm font-semibold">Your family's money life, private by default.</p>
          <button onClick={begin} className="btn-pop w-full">
            Create a family
          </button>
          <button onClick={() => setMode('import')} className="btn-pop w-full" style={{ background: 'var(--m-lavender)' }}>
            I have a recovery code
          </button>
          <button onClick={() => setMode('kid')} className="btn-pop w-full" style={{ background: 'var(--m-gold)' }}>
            I'm a kid joining my family
          </button>
        </section>
      )}

      {mode === 'show-code' && (
        <section className="card-pop space-y-3" style={{ background: 'var(--m-gold)' }}>
          <h2 className="label">Save this now — it's the only way back in</h2>
          <p className="text-xs font-semibold">
            No account, no password reset. If you lose this code and clear your browser, the family board is gone forever.
          </p>
          <code className="block break-all rounded-xl border-2 border-[var(--m-ink)] bg-white p-2 text-xs">{code}</code>
          <div className="flex gap-2">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(code).then(() => toast('Copied ✓'))
              }}
              className="btn-pop"
            >
              Copy
            </button>
            <button onClick={() => setRole('parent')} className="btn-pop ml-auto" style={{ background: 'var(--m-lavender)' }}>
              Skip for demo
            </button>
          </div>
          <button onClick={() => setMode('start')} className="w-full text-xs underline opacity-70">
            ← back
          </button>
        </section>
      )}

      {mode === 'import' && (
        <section className="card-pop space-y-3">
          <h2 className="label">Restore from recovery code</h2>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="maestro:v1:…"
            className="w-full rounded-xl border-2 border-[var(--m-ink)] p-2 text-xs"
            rows={3}
          />
          <button onClick={doImport} className="btn-pop w-full">
            Restore family
          </button>
              <button onClick={() => setMode('start')} className="w-full text-xs underline opacity-70">
            ← back
          </button>
        </section>
      )}

      {mode === 'kid' && (
        <section className="card-pop space-y-3" style={{ background: 'var(--m-gold)' }}>
          <h2 className="label">Join your family</h2>
          <input
            value={familyId}
            onChange={(e) => setFamilyId(e.target.value)}
            placeholder="Family ID (ask a parent)"
            className="w-full rounded-xl border-2 border-[var(--m-ink)] px-3 py-2 text-sm"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-xl border-2 border-[var(--m-ink)] px-3 py-2 text-sm"
          />
          <button onClick={() => void kidJoin()} className="btn-pop w-full">
            Join
          </button>
          <p className="text-xs opacity-70">Connect your wallet first — your reward address comes from it.</p>
          <button onClick={() => setMode('start')} className="w-full text-xs underline opacity-70">
            ← back
          </button>
        </section>
      )}
    </div>
  )
}
