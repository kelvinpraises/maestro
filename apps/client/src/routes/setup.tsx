// /setup — the parent's family-creation flow, ported from maestro-redacted's
// three-beat setup: 1. name the family  2. add kids  3. pick starter chores.
// One warm screen per beat, one primary action each. Finishing mints the
// encrypted family (board key + id) and seeds chores into the encrypted board.
import { useState } from 'react'
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { useBoard } from '#/lib/useBoard'
import { ensureFamily } from '#/lib/board'
import { exportRecovery } from '#/lib/onboarding'
import { buildInviteLink, type InvitePayload } from '#/lib/invite'
import { setRole } from '#/lib/family'
import { toast } from '#/lib/toast'
import { useWallet } from '#/lib/walletStore'

export const Route = createFileRoute('/setup')({
  // Setup is for a device with no family yet; bounce if one exists.
  beforeLoad: () => {
    if (typeof window !== 'undefined' && localStorage.getItem('maestro.board.familyId')) {
      throw redirect({ to: '/pot' })
    }
  },
  component: Setup,
})

const SUGGESTIONS = [
  { key: 'bed', name: 'Make the bed', emoji: '🛏️', reward: 0.5, defaultOn: true },
  { key: 'dishes', name: 'Wash dishes', emoji: '🍽️', reward: 0.5, defaultOn: true },
  { key: 'homework', name: 'Homework done', emoji: '📚', reward: 1.0, defaultOn: true },
  { key: 'trash', name: 'Take out trash', emoji: '🗑️', reward: 0.3 },
  { key: 'dog', name: 'Walk the dog', emoji: '🐕', reward: 0.8 },
  { key: 'room', name: 'Tidy your room', emoji: '🧹', reward: 0.5 },
]

const TOTAL_STEPS = 3
const STRK = 10n ** 18n

function Setup() {
  const navigate = useNavigate()
  const { mutate } = useBoard()
  const { account } = useWallet()
  const [step, setStep] = useState(0)
  const [familyName, setFamilyName] = useState('')
  const [kids, setKids] = useState<string[]>([])
  const [kidDraft, setKidDraft] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(SUGGESTIONS.filter((s) => s.defaultOn).map((s) => s.key)))
  const [recovery, setRecovery] = useState<{ code: string; invites: Array<{ kid: string; link: string }> } | null>(null)
  const [creating, setCreating] = useState(false)

  const addKid = () => {
    const name = kidDraft.trim()
    if (!name || kids.some((k) => k.toLowerCase() === name.toLowerCase())) { setKidDraft(''); return }
    setKids((prev) => [...prev, name]); setKidDraft('')
  }
  const toggle = (key: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const canAdvance = step === 0 ? familyName.trim().length > 0 : step === 2 ? selected.size > 0 : true

  function finish() {
    if (creating) return
    setCreating(true)
    try {
      const fam = ensureFamily()
      const code = exportRecovery(fam.familyId, fam.rawKey)
      const invites: Array<{ kid: string; link: string }> = []
      void mutate((b) => {
        b.familyName = familyName.trim()
        for (const k of kids) {
          if (!b.members?.some((m) => m.name === k)) b.members!.push({ name: k, role: 'kid', address: '' })
        }
        for (const s of SUGGESTIONS) {
          if (selected.has(s.key)) {
            b.chores.push({
              id: `${s.key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              title: s.name,
              reward: ((BigInt(Math.round(s.reward * 1000)) * STRK) / 1000n).toString(),
              state: 'todo',
            })
          }
        }
      })
      setRole('parent')
      // Invite links need the family key — kids joining via link skip manual ID pasting.
      for (const k of kids) {
        const p: InvitePayload = { familyId: fam.familyId, familyName: familyName.trim(), familyKey: fam.rawKey, kidName: k }
        invites.push({ kid: k, link: buildInviteLink(p) })
      }
      setRecovery({ code, invites })
      toast('Your family is ready! 🎉')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally { setCreating(false) }
  }

  if (recovery) {
    return (
      <div className="space-y-4 py-6">
        <h1 className="text-2xl font-extrabold">{familyName} is live 🎉</h1>
        <section className="card-pop space-y-2" style={{ background: 'var(--m-gold)' }}>
          <h2 className="label">Save this recovery code now</h2>
          <p className="text-xs font-semibold">No account, no reset. Lose it + clear browser = board gone forever.</p>
          <code className="block break-all rounded-xl border-2 border-[var(--m-ink)] bg-white p-2 text-xs">{recovery.code}</code>
          <button onClick={() => { void navigator.clipboard.writeText(recovery.code).then(() => toast('Copied ✓')) }} className="btn-pop">Copy code</button>
        </section>
        {recovery.invites.length > 0 && (
          <section className="card-pop space-y-2">
            <h2 className="label">Invite links — send each kid theirs</h2>
            <p className="text-xs opacity-70">The link carries the family key; whoever opens it joins as that kid. Share privately.</p>
            {recovery.invites.map((i) => (
              <div key={i.kid} className="flex items-center gap-2 rounded-xl border-2 border-[var(--m-ink)] bg-white p-2">
                <span className="w-12 font-display text-sm font-extrabold">{i.kid}</span>
                <input readOnly value={i.link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent text-[10px]" />
                <button onClick={() => { void navigator.clipboard.writeText(i.link).then(() => toast(`${i.kid}'s invite copied ✓`)) }} className="btn-pop !px-3 !py-1 text-xs">Copy</button>
              </div>
            ))}
          </section>
        )}
        <button onClick={() => void navigate({ to: '/pot' })} className="btn-pop w-full">Go to your Pot →</button>
      </div>
    )
  }

  return (
    <div className="space-y-4 py-4">
      {/* progress dots */}
      <div className="flex items-center justify-center gap-2">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <span key={i} className={`h-2.5 rounded-full border-2 border-[var(--m-ink)] ${i === step ? 'w-7 bg-[var(--m-green)]' : i < step ? 'w-2.5 bg-[var(--m-green)]' : 'w-2.5 bg-white'}`} />
        ))}
      </div>

      {step === 0 && (
        <section className="card-pop space-y-3 text-center">
          <div className="mx-auto flex size-20 items-center justify-center rounded-[1.6rem] border-2 border-[var(--m-ink)] text-4xl" style={{ background: 'var(--m-butter)' }}>🎹</div>
          <h1 className="text-3xl font-extrabold">Name your family</h1>
          <p className="mx-auto max-w-xs text-sm font-semibold opacity-70">This is what everyone sees at the top of the home screen.</p>
          <input autoFocus placeholder="e.g. Team Okafor" value={familyName} onChange={(e) => setFamilyName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && canAdvance && setStep(1)} className="h-14 w-full rounded-xl border-2 border-[var(--m-ink)] px-3 text-lg" />
          <button onClick={() => setStep(1)} disabled={!canAdvance} className="btn-pop w-full">Next →</button>
        </section>
      )}

      {step === 1 && (
        <section className="card-pop space-y-3">
          <h1 className="text-3xl font-extrabold">Who's on the team?</h1>
          <p className="mx-auto max-w-xs text-sm font-semibold opacity-70">Add your kids by name. You'll send each of them an invite after.</p>
          <div className="flex gap-2">
            <input autoFocus placeholder="Add a kid…" value={kidDraft} onChange={(e) => setKidDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKid()} className="h-12 w-full rounded-xl border-2 border-[var(--m-ink)] px-3" />
            <button onClick={addKid} className="btn-pop !px-4">+</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {kids.map((k) => (
              <span key={k} className="flex items-center gap-2 rounded-full border-2 border-[var(--m-ink)] px-3 py-1.5" style={{ background: 'var(--m-sky)' }}>
                <span className="font-display text-sm font-extrabold">{k}</span>
                <button onClick={() => setKids((prev) => prev.filter((x) => x !== k))} className="text-xs opacity-60 hover:text-red-500">✕</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(0)} className="flex-1 rounded-xl border-2 border-[var(--m-ink)] py-2 font-bold">← Back</button>
            <button onClick={() => setStep(2)} className="btn-pop flex-1">Next →</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="card-pop space-y-3">
          <h1 className="text-3xl font-extrabold">Pick some chores</h1>
          <p className="mx-auto max-w-xs text-sm font-semibold opacity-70">Tap the ones you want. Each pays real STRK into your kid's stash.</p>
          <div className="space-y-2">
            {SUGGESTIONS.map((c) => {
              const on = selected.has(c.key)
              return (
                <button key={c.key} onClick={() => toggle(c.key)} className={`flex w-full items-center gap-3 card-pop p-3 text-left ${on ? 'outline-2 outline-[var(--m-green)]' : ''}`}>
                  <span className="text-2xl">{c.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[15px] font-extrabold">{c.name}</span>
                    <span className="text-[13px] font-extrabold tabular-nums text-[var(--m-green)]">{c.reward.toFixed(2)} STRK</span>
                  </span>
                  <span className={`flex size-7 items-center justify-center rounded-full border-2 border-[var(--m-ink)] ${on ? 'bg-[var(--m-green)] text-white' : 'bg-white'}`}>{on && '✓'}</span>
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 rounded-xl border-2 border-[var(--m-ink)] py-2 font-bold">← Back</button>
            <button onClick={finish} disabled={!canAdvance || creating} className="btn-pop flex-1">✨ Create {familyName || 'family'}</button>
          </div>
        </section>
      )}
      {account === null && step === 2 && (
        <p className="text-center text-xs opacity-60">Tip: connect your wallet in the header so rewards can move later.</p>
      )}
    </div>
  )
}
