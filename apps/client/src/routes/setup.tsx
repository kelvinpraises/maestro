// /setup — Dana's two-minute family flow (parent door from /welcome).
// VERBATIM port of maestro-redacted setup.tsx: same beats, same copy, same
// visuals. Only deltas (marked): rewards in STRK (I1), family state written to
// the encrypted board via useBoard.mutate (I2), and a final beat showing the
// recovery code + per-kid invite links (I2-forced — the board key must reach
// kid devices through the link).
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import {
  BedIcon, TrashIcon, ForkKnifeIcon, DogIcon, BookOpenTextIcon, BroomIcon,
  ArrowLeftIcon, ArrowRightIcon, CheckIcon, PlusIcon, UserPlusIcon,
  SparkleIcon, PiggyBankIcon, XIcon,
} from '@phosphor-icons/react'
import { IconTile, type IconTileTint } from '@/components/atoms/icon-tile'
import { Button } from '@/components/atoms/button'
import { Input } from '@/components/atoms/input'
import { Label } from '@/components/atoms/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/molecules/dialog'
import { cn } from '@/utils'
import { toast } from 'sonner'
import { useBoard } from '#/lib/useBoard'
import { ensureFamily } from '#/lib/board'
import { exportRecovery } from '#/lib/onboarding'
import { buildInviteLink, type InvitePayload } from '#/lib/invite'
import { setRole } from '#/lib/family'

export const Route = createFileRoute('/setup')({
  beforeLoad: () => {
    if (typeof window !== 'undefined' && localStorage.getItem('maestro.board.familyId')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: SetupPage,
})

// A starter chore the parent can tap to include. `emoji` rides the invite link.
interface Suggestion {
  key: string
  name: string
  emoji: string
  rewardStrk: number
  icon: typeof BedIcon
  tint: IconTileTint
  defaultOn?: boolean
  assignee?: string
  repeat?: 'daily' | 'weekly' | 'once'
}

const TITLE_MAX = 28
const TITLE_COUNTER_AT = 20

const SUGGESTIONS: Suggestion[] = [
  { key: 'bed', name: 'Make the bed', emoji: '🛏️', rewardStrk: 0.5, icon: BedIcon, tint: 'sky', defaultOn: true },
  { key: 'trash', name: 'Take out trash', emoji: '🗑️', rewardStrk: 0.3, icon: TrashIcon, tint: 'green' },
  { key: 'dishes', name: 'Wash dishes', emoji: '🍽️', rewardStrk: 0.5, icon: ForkKnifeIcon, tint: 'purple', defaultOn: true },
  { key: 'dog', name: 'Walk the dog', emoji: '🐕', rewardStrk: 0.8, icon: DogIcon, tint: 'gold' },
  { key: 'homework', name: 'Homework done', emoji: '📚', rewardStrk: 1.0, icon: BookOpenTextIcon, tint: 'pink', defaultOn: true },
  { key: 'room', name: 'Tidy your room', emoji: '🧹', rewardStrk: 0.5, icon: BroomIcon, tint: 'lilac' },
]

const TOTAL_STEPS = 3

function SetupPage() {
  const navigate = useNavigate()
  const { mutate } = useBoard()
  const [step, setStep] = useState(0)
  const [familyName, setFamilyName] = useState('')
  const [kids, setKids] = useState<string[]>([])
  const [kidDraft, setKidDraft] = useState('')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(SUGGESTIONS.filter((s) => s.defaultOn).map((s) => s.key)),
  )
  const [customChores, setCustomChores] = useState<Suggestion[]>([])
  const [creating, setCreating] = useState(false)
  // DELTA (I2-forced): final beat — recovery code + invite links
  const [handoff, setHandoff] = useState<{ code: string; invites: Array<{ kid: string; link: string }> } | null>(null)

  const addKid = () => {
    const name = kidDraft.trim()
    if (!name) return
    if (kids.some((k) => k.toLowerCase() === name.toLowerCase())) { setKidDraft(''); return }
    setKids((prev) => [...prev, name]); setKidDraft('')
  }
  const removeKid = (name: string) => setKids((prev) => prev.filter((k) => k !== name))

  const allChores = [...SUGGESTIONS, ...customChores]
  const toggle = (key: string) =>
    setSelected((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const chosenCount = selected.size

  const canAdvance = step === 0 ? familyName.trim().length > 0 : step === 2 ? chosenCount > 0 : true

  const next = () => {
    if (step === 0 && !familyName.trim()) { toast.error('Give your family a name first'); return }
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1)
    else finish()
  }
  const back = () => { if (step === 0) void navigate({ to: '/welcome' }); else setStep((s) => s - 1) }

  const finish = async () => {
    if (creating) return
    setCreating(true)
    try {
      const fam = ensureFamily()
      const code = exportRecovery(fam.familyId, fam.rawKey)
      const invites: Array<{ kid: string; link: string }> = []
      await mutate((b) => {
        b.familyName = familyName.trim()
        for (const k of kids) {
          if (!b.members?.some((m) => m.name === k)) b.members!.push({ name: k, role: 'kid', address: '' })
        }
        for (const c of allChores) {
          if (selected.has(c.key)) {
            b.chores.push({
              id: `${c.key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              title: c.name,
              reward: ((BigInt(Math.round(c.rewardStrk * 1000)) * 10n ** 18n) / 1000n).toString(),
              state: 'todo',
            })
          }
        }
      })
      setRole('parent')
      for (const k of kids) {
        const p: InvitePayload = { familyId: fam.familyId, familyName: familyName.trim(), familyKey: fam.rawKey, kidName: k }
        invites.push({ kid: k, link: buildInviteLink(p) })
      }
      setHandoff({ code, invites })
      toast.success('Your family is ready! 🎉')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setCreating(false) }
  }

  if (handoff) {
    return (
      <div className="stagger-rise mx-auto w-full max-w-md space-y-4 py-8">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">{familyName} is live 🎉</h1>
        <section className="card-pop card-pop-gold space-y-2 p-4">
          <h2 className="text-microlabel opacity-70">Save this now — it's the only way back in</h2>
          <p className="text-xs font-semibold">No account, no password reset. Lose this code and clear your browser — the family board is gone forever.</p>
          <code className="block break-all rounded-xl border-2 border-[var(--m-ink)] bg-white p-2 text-xs">{handoff.code}</code>
          <Button size="sm" onClick={() => { void navigator.clipboard.writeText(handoff.code).then(() => toast.success('Copied ✓')) }}>
            Copy code
          </Button>
        </section>
        {handoff.invites.length > 0 && (
          <section className="card-pop space-y-2 p-4">
            <h2 className="text-microlabel opacity-70">Invite links — send each kid theirs</h2>
            {handoff.invites.map((i) => (
              <div key={i.kid} className="flex items-center gap-2 rounded-xl border-2 border-[var(--m-ink)] bg-white p-2">
                <span className="w-12 font-display text-sm font-extrabold">{i.kid}</span>
                <input readOnly value={i.link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent text-[10px]" />
                <Button size="sm" className="!px-3" onClick={() => { void navigator.clipboard.writeText(i.link).then(() => toast.success(`${i.kid}'s invite copied ✓`)) }}>Copy</Button>
              </div>
            ))}
          </section>
        )}
        <Button size="lg" className="w-full" onClick={() => void navigate({ to: '/dashboard' })}>
          Go to your dashboard <ArrowRightIcon className="ml-1 size-5" weight="bold" />
        </Button>
      </div>
    )
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full flex-col px-6 py-8">
      {/* Progress affordance: back caret + three dots */}
      <header className="flex items-center gap-3">
        <button onClick={back} aria-label="Back" className="press-pop flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--m-ink)] bg-white shadow-[var(--m-pop-sm)]">
          <ArrowLeftIcon className="size-5" weight="bold" />
        </button>
        <div className="flex flex-1 items-center justify-center gap-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <span key={i} className={cn('h-2.5 rounded-full border-2 border-[var(--m-ink)] transition-[width,background-color] duration-200 ease-[var(--ease-out-pop)]',
              i === step ? 'w-7 bg-[var(--m-green)]' : i < step ? 'w-2.5 bg-[var(--m-green)]' : 'w-2.5 bg-white')} />
          ))}
        </div>
        <div className="size-10 shrink-0" />
      </header>

      <div key={step} className="animate-pop-in mt-8 flex flex-1 flex-col">
        {step === 0 && <StepName value={familyName} onChange={setFamilyName} onEnter={next} />}
        {step === 1 && <StepKids kids={kids} draft={kidDraft} setDraft={setKidDraft} addKid={addKid} removeKid={removeKid} />}
        {step === 2 && (
          <StepChores
            chores={allChores} kids={kids} selected={selected} toggle={toggle}
            onAddCustom={(c) => { setCustomChores((prev) => [...prev, c]); setSelected((prev) => new Set(prev).add(c.key)) }}
          />
        )}
      </div>

      {/* One primary action, always in the same place */}
      <div className="sticky bottom-0 -mx-6 mt-4 bg-gradient-to-t from-[oklch(0.975_0.014_92)] from-55% via-[oklch(0.975_0.014_92)] via-75% to-transparent px-6 pb-3 pt-12">
        <Button size="lg" onClick={next} disabled={!canAdvance} className="w-full text-[15px]">
          {step < TOTAL_STEPS - 1 ? (
            <>Next <ArrowRightIcon className="ml-1 size-5" weight="bold" /></>
          ) : (
            <><SparkleIcon className="mr-1 size-5" weight="fill" /> Create {familyName.trim() || 'family'}</>
          )}
        </Button>
        {step === 1 && kids.length === 0 && (
          <button onClick={next} className="mt-2.5 w-full text-center text-[13px] font-bold opacity-70 hover:opacity-100">
            I'll add kids later
          </button>
        )}
      </div>
    </div>
  )
}

// ── Beat 1 — name the family ────────────────────────────────────────────────
function StepName({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex size-20 items-center justify-center rounded-[1.6rem] border-2 border-[var(--m-ink)] shadow-[var(--m-pop)]" style={{ background: 'var(--m-butter)' }}>
        <PiggyBankIcon className="size-10" weight="duotone" style={{ color: 'oklch(0.55 0.14 78)' }} />
      </div>
      <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight">Name your family</h1>
      <p className="mt-2 max-w-xs text-[15px] font-bold opacity-70 text-pretty">This is what everyone sees at the top of the home screen.</p>
      <div className="mt-7 w-full text-left">
        <Label className="mb-2 text-microlabel opacity-70">Family name</Label>
        <Input autoFocus placeholder="e.g. Team Okafor" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter()} className="h-14 text-lg" />
      </div>
    </div>
  )
}

// ── Beat 2 — add kids ───────────────────────────────────────────────────────
function StepKids({ kids, draft, setDraft, addKid, removeKid }: {
  kids: string[]; draft: string; setDraft: (v: string) => void; addKid: () => void; removeKid: (name: string) => void
}) {
  return (
    <div className="flex flex-col">
      <div className="text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Who's on the team?</h1>
        <p className="mx-auto mt-2 max-w-xs text-[15px] font-bold opacity-70 text-pretty">Add your kids by name. You'll send each of them an invite after.</p>
      </div>
      <div className="mt-7 flex items-center gap-2">
        <Input autoFocus placeholder="Add a kid…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKid()} className="h-13" />
        <button type="button" aria-label="Add kid" onClick={addKid} className="press-pop flex size-13 shrink-0 items-center justify-center rounded-2xl border-2 border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]">
          <UserPlusIcon className="size-6" weight="bold" />
        </button>
      </div>
      {kids.length > 0 ? (
        <div className="stagger-rise mt-5 flex flex-wrap gap-2.5">
          {kids.map((k) => (
            <span key={k} className="flex items-center gap-2 rounded-full border-2 border-[var(--m-ink)] py-2 pl-2 pr-3 shadow-[var(--m-pop-sm)]" style={{ background: 'var(--m-sky)' }}>
              <span className="flex size-8 items-center justify-center rounded-full border-2 border-[var(--m-ink)] bg-white font-display text-sm font-extrabold" style={{ color: 'var(--m-blue)' }}>
                {k.charAt(0).toUpperCase()}
              </span>
              <span className="font-display text-[15px] font-extrabold">{k}</span>
              <button type="button" aria-label={`Remove ${k}`} onClick={() => removeKid(k)} className="press-pop flex size-5 items-center justify-center rounded-full opacity-60 hover:text-[var(--m-pink)]">
                <XIcon className="size-3.5" weight="bold" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="card-pop mt-6 p-6 text-center">
          <IconTile icon={UserPlusIcon} tint="sky" size="lg" className="mx-auto" />
          <p className="mt-2 font-display text-sm font-extrabold">No kids yet</p>
          <p className="mt-0.5 text-[13px] font-bold opacity-70 text-pretty">Type a name above and tap the button.</p>
        </div>
      )}
    </div>
  )
}

// ── Beat 3 — starter chores ─────────────────────────────────────────────────
function StepChores({ chores, kids, selected, toggle, onAddCustom }: {
  chores: Suggestion[]; kids: string[]; selected: Set<string>; toggle: (key: string) => void; onAddCustom: (c: Suggestion) => void
}) {
  return (
    <div className="flex flex-col">
      <div className="text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Pick some chores</h1>
        <p className="mx-auto mt-2 max-w-xs text-[15px] font-bold opacity-70 text-pretty">Tap the ones you want. Each pays a little STRK into your kid's stash.</p>
      </div>
      <div className="mt-6 space-y-2.5">
        {chores.map((c) => {
          const on = selected.has(c.key)
          return (
            <button key={c.key} type="button" onClick={() => toggle(c.key)}
              className={cn('press-pop flex w-full items-center gap-3 card-pop p-3 text-left', on && 'card-pop-mint')}>
              <IconTile icon={c.icon} tint={c.tint} bordered />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-extrabold">{c.name}</p>
                <p className="text-[13px] font-extrabold tabular-nums text-[var(--m-green-ink)]">{c.rewardStrk.toFixed(2)} STRK</p>
              </div>
              <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--m-ink)]', on ? 'bg-[var(--m-green)] text-[var(--primary-foreground)]' : 'bg-white')}>
                {on && <CheckIcon className="size-4" weight="bold" />}
              </span>
            </button>
          )
        })}
      </div>
      <AddCustomChore kids={kids} onAdd={onAddCustom} />
    </div>
  )
}

const CUSTOM_EMOJI = ['✨', '🧺', '🌱', '🧼', '🚿', '🎒', '🧦', '🪥']
const REPEAT_CHIPS: { id: 'daily' | 'weekly' | 'once'; label: string }[] = [
  { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'once', label: 'Once' },
]

function AddCustomChore({ kids, onAdd }: { kids: string[]; onAdd: (c: Suggestion) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(CUSTOM_EMOJI[0])
  const [reward, setReward] = useState(0.5)
  const [assignee, setAssignee] = useState<string | undefined>(undefined)
  const [repeat, setRepeat] = useState<'daily' | 'weekly' | 'once'>('daily')

  const reset = () => { setName(''); setEmoji(CUSTOM_EMOJI[0]); setReward(0.5); setAssignee(undefined); setRepeat('daily') }
  const submit = () => {
    if (!name.trim()) { toast.error('Name the chore first'); return }
    onAdd({ key: `custom-${Date.now()}`, name: name.trim(), emoji, rewardStrk: reward, icon: SparkleIcon, tint: 'gold', assignee, repeat })
    reset(); setOpen(false); toast.success('Chore added')
  }
  const overCounter = name.length >= TITLE_COUNTER_AT

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <button type="button" onClick={() => setOpen(true)}
        className="press-pop mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--m-radius-pop)] border-2 border-dashed border-[var(--m-ink)]/40 py-3.5 font-display text-sm font-extrabold opacity-70 hover:opacity-100">
        <PlusIcon className="size-4" weight="bold" /> Add your own
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New chore</DialogTitle>
          <DialogDescription>Give it a name, pick an emoji, and set the reward.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Chore name</Label>
              {overCounter && (
                <span className={cn('text-[11px] font-extrabold tabular-nums', name.length >= TITLE_MAX ? 'text-[var(--m-pink)]' : 'opacity-60')}>
                  {name.length}/{TITLE_MAX}
                </span>
              )}
            </div>
            <Input placeholder="e.g. Feed the cat" value={name} maxLength={TITLE_MAX} onChange={(e) => setName(e.target.value.slice(0, TITLE_MAX))} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>
          <div>
            <Label className="mb-2">Emoji</Label>
            <div className="flex flex-wrap gap-1.5">
              {CUSTOM_EMOJI.map((e) => (
                <button key={e} type="button" onClick={() => setEmoji(e)}
                  className={cn('press-pop flex size-10 items-center justify-center rounded-[12px] border-2 text-xl',
                    emoji === e ? 'border-[var(--m-ink)] bg-[var(--m-green)]/20 shadow-[var(--m-pop-sm)]' : 'border-transparent bg-[var(--m-lavender)]')}>
                  <span aria-hidden>{e}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="mb-2">Who does it?</Label>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setAssignee(undefined)}
                className={cn('press-pop rounded-full border-2 px-3.5 py-1.5 font-display text-[13px] font-extrabold',
                  !assignee ? 'border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]' : 'border-[var(--m-ink)]/25 bg-white opacity-70')}>
                Anyone
              </button>
              {kids.map((k) => {
                const on = assignee === k
                return (
                  <button key={k} type="button" onClick={() => setAssignee(k)}
                    className={cn('press-pop rounded-full border-2 px-3.5 py-1.5 font-display text-[13px] font-extrabold',
                      on ? 'border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]' : 'border-[var(--m-ink)]/25 bg-white opacity-70')}>
                    {k}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <Label className="mb-2">How often?</Label>
            <div className="flex gap-1.5">
              {REPEAT_CHIPS.map((r) => {
                const on = repeat === r.id
                return (
                  <button key={r.id} type="button" onClick={() => setRepeat(r.id)}
                    className={cn('press-pop flex-1 rounded-full border-2 px-3 py-1.5 font-display text-[13px] font-extrabold',
                      on ? 'border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]' : 'border-[var(--m-ink)]/25 bg-white opacity-70')}>
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <Label className="mb-2">Reward (STRK)</Label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setReward((v) => Math.max(0.1, Math.round((v - 0.1) * 100) / 100))}
                className="press-pop flex size-10 items-center justify-center rounded-full border-2 border-[var(--m-ink)] bg-[var(--m-lavender)] font-display text-lg font-extrabold shadow-[var(--m-pop-sm)]">−</button>
              <span className="text-money flex-1 text-center text-xl text-[var(--m-green-ink)]">{reward.toFixed(2)}</span>
              <button type="button" onClick={() => setReward((v) => Math.round((v + 0.1) * 100) / 100)}
                className="press-pop flex size-10 items-center justify-center rounded-full border-2 border-[var(--m-ink)] bg-[var(--m-green)] font-display text-lg font-extrabold text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]">+</button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}><PlusIcon className="mr-2 size-4" weight="bold" /> Add chore</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
