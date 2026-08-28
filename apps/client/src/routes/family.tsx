// /family — "ours". Ported from maestro-redacted's family tab:
//   • No-family device → friendly setup card → /setup.
//   • PARENT: segmented pill switcher (Chores / Kids / Activity).
//   • KID: read-only team card.
// Invariant deltas (marked in code): data via useBoard/encrypted board (I2);
// "Send a reward" per-kid dropped — rewards flow through chore approval (I3);
// per-kid invite links carry familyId+key (I2); kids show inbox-rotation
// status (I4).
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  PlusIcon, UsersIcon, CopyIcon, CheckCircleIcon, TrashIcon,
  LinkIcon, SparkleIcon, UserPlusIcon, BroomIcon, ListChecksIcon, LockIcon,
} from '@phosphor-icons/react'
import { EmojiTile, IconTile } from '@/components/atoms/icon-tile'
import { toast } from 'sonner'
import { Button } from '@/components/atoms/button'
import { Input } from '@/components/atoms/input'
import { Label } from '@/components/atoms/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/molecules/dialog'
import { cn } from '@/utils'
import { useBoard } from '#/lib/useBoard'
import { currentRole, setRole } from '#/lib/family'
import { buildInviteLink } from '#/lib/invite'
import { fmtReward } from '#/lib/fmt'

export const Route = createFileRoute('/family')({ component: Family })

const EMOJI_CHOICES = ['🧹', '🛏️', '🍽️', '🐕', '📚', '🗑️', '🧺', '🌱']

export function Family() {
  const { board } = useBoard()
  const role = currentRole()
  const hasFamily = typeof window !== 'undefined' && !!localStorage.getItem('maestro.board.familyId')
  if (!hasFamily || !board) return <NoFamilyCard />
  return role === 'parent' ? <ParentView /> : <KidView />
}

function NoFamilyCard() {
  const navigate = useNavigate()
  return (
    <div className="stagger-rise flex flex-col items-center gap-6 pt-6 text-center">
      <div className="flex size-24 items-center justify-center rounded-[1.9rem] border-2 border-[var(--m-ink)] shadow-[var(--m-pop)]" style={{ background: 'var(--m-lilac)' }}>
        <UsersIcon className="size-11 text-[var(--m-purple)]" weight="duotone" />
      </div>
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Start your family</h1>
        <p className="mt-2 max-w-xs text-[15px] font-bold opacity-60 text-pretty">
          Name your family, add your kids, and pick a few starter chores. It takes about two minutes.
        </p>
      </div>
      <Button onClick={() => void navigate({ to: '/setup' })} size="lg" className="w-full max-w-xs">
        <SparkleIcon className="mr-2 size-5" weight="fill" /> Set up my family
      </Button>
    </div>
  )
}

// ── parent view ─────────────────────────────────────────────────────────────
type Group = 'chores' | 'kids' | 'activity'
const GROUPS: { id: Group; label: string }[] = [
  { id: 'chores', label: 'Chores' }, { id: 'kids', label: 'Kids' }, { id: 'activity', label: 'Activity' },
]

function ParentView() {
  const [group, setGroup] = useState<Group>('chores')
  return (
    <div className="space-y-4">
      <GroupSwitcher group={group} onChange={setGroup} />
      <div key={group} className="animate-pop-in">
        {group === 'chores' && <ChoresSection />}
        {group === 'kids' && <KidsSection />}
        {group === 'activity' && <ActivitySection />}
      </div>
    </div>
  )
}

function GroupSwitcher({ group, onChange }: { group: Group; onChange: (g: Group) => void }) {
  return (
    <div role="tablist" aria-label="Family sections" className="flex gap-1 rounded-full border-2 border-[var(--m-ink)] bg-white p-1 shadow-[var(--m-pop-sm)]">
      {GROUPS.map((g) => {
        const active = g.id === group
        return (
          <button key={g.id} type="button" role="tab" aria-selected={active} onClick={() => onChange(g.id)}
            className={cn('press-pop flex-1 rounded-full py-2 font-display text-sm font-extrabold',
              active ? 'border-2 border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]' : 'border-2 border-transparent opacity-60 hover:opacity-100')}>
            {g.label}
          </button>
        )
      })}
    </div>
  )
}

// ── chores group ────────────────────────────────────────────────────────────
function ChoresSection() {
  const { board, mutate } = useBoard()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0])
  const [reward, setReward] = useState(1)
  const [assignee, setAssignee] = useState<string | undefined>(undefined)
  const kids = board?.members?.filter((m) => m.role === 'kid') ?? []

  const reset = () => { setName(''); setEmoji(EMOJI_CHOICES[0]); setReward(1); setAssignee(undefined) }
  const handleAdd = () => {
    if (!name.trim()) { toast.error('Name the chore first'); return }
    mutate((b) => {
      b.chores.push({
        id: crypto.randomUUID(), title: name.trim(),
        reward: ((BigInt(Math.round(reward * 1000)) * 10n ** 18n) / 1000n).toString(), state: 'todo',
      })
    })
    reset(); setOpen(false); toast.success('Chore added')
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <ListChecksIcon className="size-4 text-[var(--m-gold)]" weight="duotone" />
          Chores
        </h2>
      </div>
      <div className="space-y-2.5">
        {(board?.chores ?? []).map((c) => (
          <div key={c.id} className="card-pop flex items-center gap-3 p-3">
            <EmojiTile emoji="🧹" tint="neutral" bordered />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[15px] font-extrabold">{c.title}</p>
              <p className="text-[13px] font-extrabold tabular-nums text-[var(--m-green-ink)]">{fmtReward(c.reward)} STRK</p>
            </div>
            <button aria-label="Remove chore" onClick={() => mutate((b) => { b.chores = b.chores.filter((x) => x.id !== c.id) })}
              className="press-pop rounded-full p-1.5 opacity-50 hover:opacity-100">
              <TrashIcon className="size-4" weight="bold" />
            </button>
          </div>
        ))}
        {(board?.chores.length ?? 0) === 0 && (
          <div className="card-pop p-6 text-center">
            <IconTile icon={BroomIcon} tint="lilac" size="lg" className="mx-auto" />
            <p className="mt-2 font-display text-sm font-extrabold">No chores yet</p>
            <p className="mt-0.5 text-[13px] font-bold opacity-60">Add one below.</p>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <button type="button" onClick={() => setOpen(true)}
          className="press-pop mt-1 flex w-full items-center justify-center gap-2 rounded-[var(--m-radius-pop)] border-2 border-dashed border-[var(--m-ink)]/40 py-3.5 font-display text-sm font-extrabold opacity-70 hover:opacity-100">
          <PlusIcon className="size-4" weight="bold" /> Add a chore
        </button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New chore</DialogTitle>
            <DialogDescription>Give it a name, pick an emoji, and set the reward.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label className="mb-2">Chore name</Label>
              <Input placeholder="e.g. Feed the cat" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label className="mb-2">Emoji</Label>
              <div className="flex flex-wrap gap-1.5">
                {EMOJI_CHOICES.map((e) => (
                  <button key={e} type="button" onClick={() => setEmoji(e)}
                    className={cn('press-pop flex size-10 items-center justify-center rounded-[12px] border-2 text-xl',
                      emoji === e ? 'border-[var(--m-ink)] bg-[var(--m-green)]/20 shadow-[var(--m-pop-sm)]' : 'border-transparent bg-[var(--m-lavender)]')}>
                    <span aria-hidden>{e}</span>
                  </button>
                ))}
              </div></div>
            <div><Label className="mb-2">Who does it?</Label>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setAssignee(undefined)}
                  className={cn('press-pop rounded-full border-2 px-3.5 py-1.5 font-display text-[13px] font-extrabold',
                    !assignee ? 'border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]' : 'border-[var(--m-ink)]/25 bg-white opacity-70')}>Anyone</button>
                {kids.map((k) => (
                  <button key={k.address || k.name} type="button" onClick={() => setAssignee(k.name)}
                    className={cn('press-pop rounded-full border-2 px-3.5 py-1.5 font-display text-[13px] font-extrabold',
                      assignee === k.name ? 'border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]' : 'border-[var(--m-ink)]/25 bg-white opacity-70')}>{k.name}</button>
                ))}
              </div></div>
            <div><Label className="mb-2">Reward (STRK)</Label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setReward((v) => Math.max(0.1, Math.round((v - 0.1) * 100) / 100))}
                  className="press-pop flex size-10 items-center justify-center rounded-full border-2 border-[var(--m-ink)] bg-[var(--m-lavender)] font-display text-lg font-extrabold shadow-[var(--m-pop-sm)]">−</button>
                <span className="text-money flex-1 text-center text-xl text-[var(--m-green-ink)]">{reward.toFixed(2)}</span>
                <button type="button" onClick={() => setReward((v) => Math.round((v + 0.1) * 100) / 100)}
                  className="press-pop flex size-10 items-center justify-center rounded-full border-2 border-[var(--m-ink)] bg-[var(--m-green)] font-display text-lg font-extrabold text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]">+</button>
              </div></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd}><PlusIcon className="mr-2 size-4" weight="bold" /> Add chore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── kids group ──────────────────────────────────────────────────────────────
function KidsSection() {
  const { board, mutate } = useBoard()
  const [inviteFor, setInviteFor] = useState<string | null>(null)
  const [newKid, setNewKid] = useState('')
  const kids = board?.members?.filter((m) => m.role === 'kid') ?? []
  const famId = typeof window !== 'undefined' ? localStorage.getItem('maestro.board.familyId') : null
  const famKey = typeof window !== 'undefined' ? localStorage.getItem('maestro.board.familyKey') : null

  const inviteLink = (kid: string) => {
    if (!famId || !famKey) return ''
    return buildInviteLink({ familyId: famId, familyName: board?.familyName || 'our family', familyKey: famKey, kidName: kid })
  }
  const addKidName = (name: string) => {
    mutate((b) => { if (!b.members?.some((m) => m.name === name)) b.members!.push({ name, role: 'kid', address: '' }) })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <UsersIcon className="size-4 text-[var(--m-purple)]" weight="duotone" />
          Kids
        </h2>
      </div>
      <div className="space-y-2.5">
        {kids.map((k) => (
          <div key={k.address || k.name} className="card-pop p-3">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-[13px] border-2 border-[var(--m-ink)] font-display text-lg font-extrabold shadow-[var(--m-pop-sm)]" style={{ background: 'var(--m-sky)', color: 'var(--m-blue)' }}>
                {k.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-extrabold">{k.name}</p>
                <p className="truncate text-[11px] font-bold opacity-60">
                  {k.allowanceInbox ? `inbox ${k.allowanceInbox.slice(0, 10)}… active` : 'no inbox yet — they mint one on their device'}
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button type="button" onClick={() => setInviteFor(k.name)}
                className="press-pop flex flex-1 items-center justify-center gap-1.5 rounded-full border-2 border-[var(--m-ink)] bg-white px-3 py-2 text-xs font-extrabold shadow-[var(--m-pop-sm)]">
                <LinkIcon className="size-3.5" weight="bold" /> Invite
              </button>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input placeholder="Add a kid…" value={newKid} onChange={(e) => setNewKid(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newKid.trim()) { addKidName(newKid.trim()); setNewKid('') } }} />
          <button type="button" aria-label="Add kid" onClick={() => { if (newKid.trim()) { addKidName(newKid.trim()); setNewKid('') } }}
            className="press-pop flex size-11 shrink-0 items-center justify-center rounded-2xl border-2 border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)] shadow-[var(--m-pop-sm)]">
            <UserPlusIcon className="size-5" weight="bold" />
          </button>
        </div>
      </div>

      <Dialog open={!!inviteFor} onOpenChange={(o) => !o && setInviteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite {inviteFor}</DialogTitle>
            <DialogDescription>
              Send this link to {inviteFor}'s device. It carries your family key — share it privately.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <input readOnly value={inviteFor ? inviteLink(inviteFor) : ''} onFocus={(e) => e.currentTarget.select()}
              className="field-pop min-w-0 flex-1 text-[10px]" />
            <Button size="sm" onClick={() => { void navigator.clipboard.writeText(inviteFor ? inviteLink(inviteFor) : '').then(() => toast.success('Invite link copied!')) }}>
              <CopyIcon className="mr-1 size-4" weight="bold" /> Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── activity group ──────────────────────────────────────────────────────────
function ActivitySection() {
  const { board } = useBoard()
  const entries = [
    ...(board?.approvals ?? []).map((a) => ({ icon: <CheckCircleIcon className="size-5 text-[var(--m-green-ink)]" weight="duotone" />, text: 'Reward paid privately', at: a.at })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-1.5 px-1 font-display text-lg font-extrabold">
        <LockIcon className="size-4 text-[var(--m-purple)]" weight="duotone" /> Private activity
      </h2>
      {entries.length === 0 ? (
        <div className="card-pop p-6 text-center">
          <p className="font-display text-sm font-extrabold">Nothing yet</p>
          <p className="mt-0.5 text-[13px] font-bold opacity-60">Approvals and private payouts land here.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map((e, i) => (
            <div key={i} className="card-pop flex items-center gap-3 p-3">{e.icon}<p className="min-w-0 flex-1 text-sm font-bold">{e.text}</p></div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── kid view ────────────────────────────────────────────────────────────────
function KidView() {
  const { board } = useBoard()
  return (
    <div className="space-y-4">
      <div className="card-pop card-pop-sky flex items-center gap-3 p-4">
        <IconTile icon={UsersIcon} tint="sky" size="lg" bordered />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-extrabold">{board?.familyName || 'Your family'}</p>
          <p className="text-[12px] font-bold opacity-60">
            {(board?.members ?? []).length} on the team — you're on it.
          </p>
        </div>
      </div>
      <section className="card-pop p-4">
        <p className="text-microlabel opacity-60">The team</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(board?.members ?? []).map((m) => (
            <span key={m.address || m.name} className="flex items-center gap-1.5 rounded-full border-2 border-[var(--m-ink)] px-2.5 py-1 text-xs font-extrabold" style={{ background: 'var(--m-sky)' }}>
              {m.name}{m.role === 'parent' ? ' 👑' : ''}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}

// role switch nudge for demo parity (hidden helper used by parent gate)
export function RoleSwitchToParent() {
  return <button hidden onClick={() => setRole('parent')} />
}
