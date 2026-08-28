// /join — a kid device opens the family invite link (#invite=<blob>).
// Ported from maestro-redacted's join flow, adapted to the encrypted board:
// the link carries familyId + familyKey, so this device lands fully synced
// (name set, chores visible) with zero typing. Hash is stripped after import.
import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { decodeInvite, readAndStripInvite } from '#/lib/invite'
import { ensureFamily } from '#/lib/board'
import { setRole } from '#/lib/family'
import { toast } from '#/lib/toast'

export const Route = createFileRoute('/join')({ component: Join })

function Join() {
  const navigate = useNavigate()
  // Parse the blob on FIRST render (before an effect can strip the hash —
  // React StrictMode double-mounts, and the second pass must still find it).
  const [{ payload, invalid }] = useState(() => {
    const blob = readAndStripInvite()
    if (!blob) return { payload: null, invalid: true }
    const d = decodeInvite(blob)
    return 'error' in d ? { payload: null, invalid: true } : { payload: d, invalid: false }
  })
  const [joining, setJoining] = useState(false)

  function join() {
    if (!payload || joining) return
    setJoining(true)
    try {
      // Adopt the family: parent's board id + key (they chose to share them).
      localStorage.setItem('maestro.board.familyId', payload.familyId)
      localStorage.setItem('maestro.board.key', payload.familyKey)
      ensureFamily() // no-op — familyId/key now present
      setRole('kid')
      toast(`Welcome to ${payload.familyName}, ${payload.kidName}! 🎈`)
      void navigate({ to: '/chores' })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally { setJoining(false) }
  }

  if (invalid || !payload) {
    return (
      <div className="stagger-rise space-y-4 py-10 text-center">
        <div className="animate-float-soft mx-auto flex size-20 items-center justify-center rounded-[1.6rem] border-2 border-[var(--m-ink)] text-4xl" style={{ background: 'var(--m-lavender)' }}>🔗</div>
        <h1 className="text-3xl font-extrabold">That link didn't work</h1>
        <p className="mx-auto max-w-xs text-sm font-semibold opacity-70">
          Invite links look like <code className="text-xs">…/join#invite=…</code> and are single-purpose. Ask your grown-up to send it again.
        </p>
        <button onClick={() => void navigate({ to: '/welcome' })} className="btn-pop">Back to the front door</button>
      </div>
    )
  }

  return (
    <div className="stagger-rise space-y-5 py-8 text-center">
      <div className="animate-float-soft mx-auto flex size-24 items-center justify-center rounded-[1.9rem] border-2 border-[var(--m-ink)] text-5xl" style={{ background: 'var(--m-lilac)' }}>🎈</div>
      <h1 className="text-3xl font-extrabold">Join {payload.familyName}?</h1>
      <p className="mx-auto max-w-xs text-sm font-semibold opacity-70">
        You're joining as <b>{payload.kidName}</b>. The family's encrypted board will live on this device.
      </p>
      <section className="card-pop card-pop-sky mx-auto max-w-xs p-4 text-left">
        <p className="text-microlabel" style={{ color: "var(--m-blue)" }}>How it works</p>
        <ol className="mt-1 space-y-1 text-[13px] font-bold opacity-80">
          <li>1. Your grown-up tapped "Invite" on their phone.</li>
          <li>2. They sent you this link.</li>
          <li>3. You tapped it. Balloons — you're on the team!</li>
        </ol>
      </section>
      <button onClick={join} disabled={joining} className="btn-pop w-full max-w-xs">🎈 I'm on the team</button>
    </div>
  )
}
