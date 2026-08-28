// /dashboard — the Home tab. Ported from maestro-redacted's dashboard structure:
// role-split Home (ParentHome / KidHome), header with avatar + greeting,
// "Needs your nod" approval cards, family bank card, chores overview with
// Manage link (parent); earnings hero, stash card, "My chores today" (kid).
//
// Invariant deltas (marked): data from encrypted board via useBoard (I2);
// approve = our two-phase privateTransfer payout (I1/I3); allowance card →
// /allowance with rotating inboxes (I4); STRK everywhere (I1).
import { useState, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  SparkleIcon, BroomIcon, CheckCircleIcon, CaretRightIcon,
  BankIcon, DropIcon, HandHeartIcon, SpinnerGapIcon, CheckIcon,
  ArrowClockwiseIcon,
} from '@phosphor-icons/react'
import type { WalletAccountV6 } from 'starknet'
import { useBoard } from '#/lib/useBoard'
import { useWallet } from '#/lib/walletStore'
import { currentRole } from '#/lib/family'
import { shieldedBalances, privateTransfer } from '#/lib/strk20'
import { strkToken } from '#/lib/starknet'
import { startApproval, markPaid, revertToPending, claimChore } from '#/lib/chore-logic'
import { toast } from '#/lib/toast'
import { IconTile, EmojiTile } from '@/components/atoms/icon-tile'
import { Button } from '@/components/atoms/button'
import { cn } from '@/utils'

export const Route = createFileRoute('/dashboard')({ component: Dashboard })

const STRK = 10n ** 18n
function fmtReward(felt: string): string {
  try { return `${Number((BigInt(felt) * 100n) / STRK) / 100}` } catch { return '?' }
}

function Dashboard() {
  const role = currentRole()
  if (role === 'kid') return <KidHome />
  return <ParentHome />
}

// ── shared header (avatar + greeting) ───────────────────────────────────────
function HomeHeader({ avatarSeed, tint, title, subtitle }: { avatarSeed: string; tint: string; title: string; subtitle: string }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 border-[var(--m-ink)] font-display text-lg font-bold shadow-[var(--m-pop-sm)]', tint)}>
          {avatarSeed.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-extrabold leading-tight">{title}</h1>
          <p className="truncate text-sm font-semibold opacity-60">{subtitle}</p>
        </div>
      </div>
    </header>
  )
}

// ── parent home ─────────────────────────────────────────────────────────────
function ParentHome() {
  const navigate = useNavigate()
  const { board, mutate } = useBoard()
  const { account, chainId } = useWallet()
  const familyName = board?.familyName?.trim() || 'your family'
  const chores = board?.chores ?? []

  const [busyId, setBusyId] = useState<string | null>(null)
  const [justPaid, setJustPaid] = useState<Set<string>>(new Set())

  // Needs your nod — one card per pending chore.
  const nodEntries = chores.filter((c) => c.state === 'pending' || (c.state === 'paying' && busyId === c.id) || justPaid.has(c.id))
  const activeChores = chores.filter((c) => c.state !== 'approved' && c.state !== 'paying')

  async function approve(choreId: string) {
    if (!board || !account || !chainId) { toast('Connect the parent wallet first.', 'error'); return }
    const chore = board.chores.find((c) => c.id === choreId)!
    const kid = board.members?.find((m) => m.role === 'kid')
    if (!kid) { toast('No kid registered yet — they must join from their device.', 'error'); return }
    const token = strkToken(chainId)
    if (!token) { toast(`No STRK token configured for this chain.`, 'error'); return }
    setBusyId(choreId)
    try {
      await mutate((b) => startApproval(b, choreId))
      const balances = await shieldedBalances(account as WalletAccountV6)
      const held = balances.find((b) => b.token.toLowerCase() === token.toLowerCase())
      if (!held || BigInt(held.balance) < BigInt(chore.reward)) {
        throw new Error(`insufficient shielded balance${held ? ` (have ${fmtReward(held.balance)})` : ''}`)
      }
      const r = await privateTransfer(account as WalletAccountV6, chainId, token, chore.reward, kid.address)
      await mutate((b) => markPaid(b, choreId, r.hash))
      toast(`Reward sent to ${kid.name} 🎁`)
      setJustPaid((s) => new Set(s).add(choreId))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      await mutate((b) => revertToPending(b, choreId)).catch(() => {})
    } finally { setBusyId(null) }
  }

  return (
    <div className="stagger-rise space-y-5">
      <HomeHeader
        avatarSeed={familyName} tint="bg-[var(--m-lilac)] text-[var(--m-purple)]"
        title={familyName} subtitle="Here's how the team is doing."
      />

      {/* Needs your nod */}
      {nodEntries.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
              <HandHeartIcon className="size-4 text-[var(--m-green-ink)]" weight="duotone" />
              Needs your nod
            </h2>
            <span className="rounded-full border-2 border-[var(--m-ink)] bg-[var(--m-green)]/20 px-2.5 py-0.5 text-xs font-extrabold text-[var(--m-green-ink)]">
              {nodEntries.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {nodEntries.map((c) => (
              <div key={c.id} className="animate-pop-in card-pop card-pop-mint p-3.5">
                <div className="flex items-center gap-3">
                  <EmojiTile emoji="✅" tint="green" size="lg" bordered />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[15px] font-extrabold">{c.title}</p>
                    <p className="text-[13px] font-bold opacity-60">
                      {c.state === 'approved' ? 'Paid ✓' : c.state === 'paying' ? 'Sending…' : 'says it\'s done'}
                      {' · '}
                      <span className="font-extrabold tabular-nums text-[var(--m-green-ink)]">{fmtReward(c.reward)} STRK</span>
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  {c.state === 'approved' ? (
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setJustPaid((s) => { const n = new Set(s); n.delete(c.id); return n })}>Done</Button>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" className="flex-1" disabled={busyId === c.id}
                        onClick={() => { void mutate((b) => revertToPending(b, c.id)); toast('Sent back to the kid') }}>
                        Not yet
                      </Button>
                      <Button size="sm" className="flex-1" disabled={busyId === c.id} onClick={() => void approve(c.id)}>
                        {busyId === c.id ? <SpinnerGapIcon className="mr-1 size-4 animate-spin" weight="bold" /> : <CheckIcon className="mr-1 size-4" weight="bold" />}
                        Nod & pay
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Family bank — shielded pot balance + top-up → /dev/money when on */}
      <FamilyBankCard />

      {/* Chores overview */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <SparkleIcon className="size-4 text-[var(--m-gold)]" weight="fill" />
            Chores
          </h2>
          <button onClick={() => void navigate({ to: '/family' })} className="flex items-center gap-0.5 text-xs font-extrabold opacity-60 hover:opacity-100">
            Manage <CaretRightIcon className="size-3.5" weight="bold" />
          </button>
        </div>
        {chores.length === 0 ? (
          <button onClick={() => void navigate({ to: '/family' })} className="animate-pop-in press-pop card-pop flex w-full items-center gap-3 p-5 text-left">
            <IconTile icon={BroomIcon} tint="lilac" size="lg" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-extrabold">No chores yet</p>
              <p className="text-[13px] font-bold opacity-60 text-pretty">Add a few and they show up on everyone's home.</p>
            </div>
            <CaretRightIcon className="size-5 opacity-60" weight="bold" />
          </button>
        ) : activeChores.length === 0 ? (
          <div className="card-pop flex items-center gap-3 p-4" style={{ background: 'color-mix(in oklab, var(--m-mint) 40%, white)' }}>
            <IconTile icon={CheckCircleIcon} tint="green" bordered />
            <p className="font-display text-[15px] font-extrabold">All caught up for today!</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {activeChores.map((c) => {
              const waiting = c.state === 'pending'
              return (
                <div key={c.id} className="card-pop flex items-center gap-3 p-3">
                  <EmojiTile emoji="🧹" tint="neutral" bordered />
                  <p className="min-w-0 flex-1 truncate font-display text-[15px] font-extrabold">{c.title}</p>
                  {waiting ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--m-ink)]/25 bg-[var(--m-sky)]/60 px-2.5 py-0.5 text-[13px] font-extrabold text-[var(--m-blue)]">Waiting</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--m-ink)]/25 bg-white/70 px-2.5 py-0.5 text-[13px] font-extrabold tabular-nums text-[var(--m-green-ink)]">+{fmtReward(c.reward)} STRK</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function FamilyBankCard() {
  const navigate = useNavigate()
  const [bal] = useState<string | null>(null)
  return (
    <div className="animate-pop-in card-pop card-pop-butter p-4">
      <div className="flex items-center gap-3">
        <IconTile icon={BankIcon} tint="gold" bordered />
        <div className="min-w-0 flex-1">
          <p className="text-microlabel opacity-60">Family bank</p>
          <p className="text-money text-2xl leading-tight">
            {bal ?? '…'}<span className="ml-1 text-xs font-bold opacity-60">STRK</span>
          </p>
        </div>
      </div>
      <p className="mt-2.5 text-[12px] font-semibold opacity-60 text-pretty">
        Rewards move privately through the STRK20 pool — nobody sees which kid got paid.
      </p>
      <button onClick={() => void navigate({ to: '/allowance' })}
        className="press-pop mt-3 flex w-full items-center gap-2 rounded-2xl border-2 border-[var(--m-ink)]/25 bg-white/60 px-3.5 py-2.5 text-left">
        <DropIcon className="size-4 shrink-0 text-[var(--m-green-ink)]" weight="duotone" />
        <span className="min-w-0 flex-1 truncate font-display text-[13px] font-extrabold">Set up allowance</span>
        <CaretRightIcon className="size-4 shrink-0 opacity-60" weight="bold" />
      </button>
    </div>
  )
}

// ── kid home ────────────────────────────────────────────────────────────────
function KidHome() {
  const navigate = useNavigate()
  const { board, mutate } = useBoard()
  const { account } = useWallet()
  void navigate
  const chores = board?.chores ?? []
  const me = board?.members?.find((m) => m.role === 'kid')
  const kidName = me?.name?.trim() || 'there'

  const { mine, done } = useMemo(() => {
    const mine = chores.filter((c) => c.state === 'todo' || c.state === 'pending')
    const done = chores.filter((c) => c.state === 'approved' || c.state === 'paying')
    return { mine, done }
  }, [chores])
  const choresLeft = mine.length
  const allDone = chores.length > 0 && choresLeft === 0

  function claim(choreId: string) {
    if (!account) { toast('Connect your wallet first — Me tab → Connect wallet', 'error'); return }
    mutate((b) => claimChore(b, choreId))
  }

  return (
    <div className="stagger-rise space-y-5">
      <HomeHeader
        avatarSeed={kidName} tint="bg-[var(--m-butter)]"
        title={`Hi, ${kidName}!`} subtitle="Here's what you can earn."
      />

      {/* My stash card — butter card, balance + drip line */}
      <KidStashCardInline />

      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <SparkleIcon className="size-4 text-[var(--m-gold)]" weight="fill" />
            My chores today
          </h2>
          {choresLeft > 0 && (
            <span className="rounded-full border-2 border-[var(--m-ink)] bg-[var(--m-green)]/20 px-2.5 py-0.5 text-xs font-extrabold text-[var(--m-green-ink)]">{choresLeft} left</span>
          )}
        </div>

        {chores.length === 0 ? (
          <div className="card-pop p-6 text-center">
            <IconTile icon={BroomIcon} tint="lilac" size="lg" className="mx-auto" />
            <p className="mt-2 font-display text-sm font-extrabold">No chores yet</p>
            <p className="mt-0.5 text-[13px] font-bold opacity-60 text-pretty">Your grown-up will add some soon!</p>
          </div>
        ) : (
          <>
            {allDone && (
              <div className="card-pop card-pop-mint p-5 text-center">
                <p className="font-display text-lg font-extrabold text-[var(--m-green-ink)]">You crushed everything today! 💪</p>
                <p className="mt-0.5 text-[13px] font-bold text-[var(--m-green-ink)]/70">Come back tomorrow for more.</p>
              </div>
            )}
            <div className="space-y-2.5">
              {mine.map((c) => (
                <button key={c.id} onClick={() => void claim(c.id)}
                  className={cn('press-pop card-pop flex w-full items-center gap-3.5 p-3 text-left', c.state === 'pending' && 'card-pop-sky')}>
                  <EmojiTile emoji="🧹" tint={c.state === 'pending' ? 'blue' : 'butter'} size="lg" bordered />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[15px] font-bold">{c.title}</p>
                    {c.state === 'pending' && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border-2 border-[var(--m-ink)] bg-white/85 px-2.5 py-0.5 text-[11px] font-extrabold text-[var(--m-blue)]">
                        Waiting for the grown-ups 👀
                      </span>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--m-ink)]/25 bg-white/70 px-2 py-0.5 text-[13px] font-extrabold tabular-nums text-[var(--m-green-ink)]">
                    +{fmtReward(c.reward)} STRK
                  </span>
                </button>
              ))}
              {done.map((c) => (
                <div key={c.id} className="card-pop card-pop-mint flex w-full items-center gap-3.5 p-3 opacity-60">
                  <EmojiTile emoji="✅" tint="green" size="lg" bordered />
                  <p className="min-w-0 flex-1 truncate font-display text-[15px] font-bold line-through decoration-2">{c.title}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function KidStashCardInline() {
  const navigate = useNavigate()
  const { board } = useBoard()
  return (
    <div className="animate-pop-in card-pop card-pop-butter overflow-hidden">
      <button type="button" onClick={() => void navigate({ to: '/me' })} className="press-pop flex w-full items-center gap-3 p-4 text-left">
        <IconTile icon={BankIcon} tint="gold" bordered />
        <div className="shrink-0">
          <p className="text-microlabel whitespace-nowrap opacity-60">My Stash</p>
          <p className="text-money whitespace-nowrap text-xl tabular-nums">…<span className="ml-1 text-[11px] font-bold opacity-60">STRK</span></p>
        </div>
        <span className="flex-1" />
        <CaretRightIcon className="size-5 shrink-0 opacity-60" weight="bold" />
      </button>
      {board?.streams?.length ? (
        <div className="border-t-2 border-[var(--m-ink)]/15 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="drip-dot flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--m-mint)] text-[var(--m-green-ink)]">
              <DropIcon className="size-3.5" weight="fill" />
            </span>
            <p className="min-w-0 flex-1 text-[13px] font-extrabold text-[var(--m-green-ink)]">Dripping in</p>
            <ArrowClockwiseIcon className="size-4 shrink-0 opacity-60" weight="bold" />
          </div>
        </div>
      ) : null}
    </div>
  )
}
