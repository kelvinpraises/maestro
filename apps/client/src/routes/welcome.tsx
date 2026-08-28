// /welcome — the front door. Ported from maestro-redacted's welcome: piggy
// mascot, two doors, friendly kid explainer. Adapted to the encrypted board:
// "grown-up" → /setup (mints family + recovery code), invite → /join.
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { PiggyBankIcon, HeartHalfIcon, LinkSimpleIcon, ArrowLeftIcon, ArrowRightIcon } from '@phosphor-icons/react'
import { setRole } from '#/lib/family'

export const Route = createFileRoute('/welcome')({
  // If this device already has a family, the front door is behind us.
  beforeLoad: () => {
    if (typeof window !== 'undefined' && localStorage.getItem('maestro.board.familyId')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: WelcomePage,
})

function WelcomePage() {
  const navigate = useNavigate()
  const [view, setView] = useState<'doors' | 'invite'>('doors')

  return (
    <div className="flex w-full flex-col items-center gap-7 text-center">
      {view === 'doors' ? (
        <div className="stagger-rise flex w-full flex-col items-center gap-7">
          <div className="flex flex-col items-center gap-5">
            <div className="animate-float-soft flex size-28 items-center justify-center rounded-[2rem] border-2 border-[var(--m-ink)] shadow-[var(--m-pop-lg)]" style={{ background: 'var(--m-butter)' }}>
              <PiggyBankIcon className="size-16" weight="duotone" style={{ color: 'oklch(0.55 0.14 78)' }} />
            </div>
            <div>
              <h1 className="font-display text-[2.6rem] font-extrabold leading-none tracking-tight">Maestro</h1>
              <p className="mx-auto mt-3 max-w-[17rem] text-[15px] font-bold text-pretty opacity-70">
                Chores your kids actually want to do, with a real stash they keep.
              </p>
            </div>
          </div>

          <div className="mt-1 flex w-full max-w-xs flex-col gap-3">
            <button
              onClick={() => void navigate({ to: '/setup' })}
              className="btn-pop flex w-full items-center justify-between text-[15px]"
            >
              <span className="flex items-center gap-2.5">
                <HeartHalfIcon className="size-5" weight="fill" />
                I'm the grown-up
              </span>
              <ArrowRightIcon className="size-5" weight="bold" />
            </button>
            <button
              onClick={() => setView('invite')}
              className="press-pop flex w-full items-center justify-between rounded-full border-2 border-[var(--m-ink)] bg-white py-2.5 pl-4 pr-3 text-[15px] font-extrabold"
            >
              <span className="flex items-center gap-2.5">
                <LinkSimpleIcon className="size-5" weight="bold" style={{ color: 'var(--m-purple)' }} />
                I got an invite
              </span>
              <ArrowRightIcon className="size-5" weight="bold" />
            </button>
          </div>

          <p className="max-w-[16rem] text-xs font-bold opacity-70 text-pretty">
            No passwords. Your family bank is made for you in a tap.
          </p>
        </div>
      ) : (
        <div className="stagger-rise flex w-full flex-col items-center gap-7">
          <div className="flex size-24 items-center justify-center rounded-[1.9rem] border-2 border-[var(--m-ink)] text-4xl shadow-[var(--m-pop)]" style={{ background: 'var(--m-lilac)' }}>
            <LinkSimpleIcon weight="duotone" style={{ color: 'var(--m-purple)' }} />
          </div>
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Got a family link?</h1>
            <p className="mx-auto mt-3 max-w-xs text-[15px] font-bold opacity-70 text-pretty">
              Ask your grown-up to send you the family link. It opens right here and pops you straight onto the team.
            </p>
          </div>

          <div className="card-pop card-pop-sky w-full max-w-xs p-4 text-left">
            <p className="text-microlabel" style={{ color: 'var(--m-blue)' }}>How it works</p>
            <ol className="mt-2 space-y-1.5 text-[13.5px] font-bold opacity-80">
              <li>1. Your grown-up taps "Invite" on their phone.</li>
              <li>2. They send you the link (texts, chats, anywhere).</li>
              <li>3. You tap it. Balloons, and you're on the team!</li>
            </ol>
          </div>

          <button
            onClick={() => setView('doors')}
            className="press-pop flex items-center gap-2 rounded-full border-2 border-[var(--m-ink)] bg-white px-6 py-2.5 text-sm font-extrabold opacity-80"
          >
            <ArrowLeftIcon className="size-4" weight="bold" />
            Back
          </button>
        </div>
      )}
      {/* role is chosen implicitly: grown-up → setup → parent; invite → join → kid */}
      <button hidden onClick={() => setRole('parent')} />
    </div>
  )
}
