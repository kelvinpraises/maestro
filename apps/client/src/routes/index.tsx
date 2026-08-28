// / — the home screen. Role-aware landing: parents land on Pot, kids on
// Chores; first-run devices bounce to /welcome. This replaces the template
// stub that shipped with the TanStack scaffold.
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useBoard } from '#/lib/useBoard'
import { currentRole } from '#/lib/family'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const navigate = useNavigate()
  const { board } = useBoard()
  const hasFamily = typeof window !== 'undefined' && !!localStorage.getItem('maestro.board.familyId')

  useEffect(() => {
    if (!hasFamily) void navigate({ to: '/welcome' })
    else void navigate({ to: currentRole() === 'kid' ? '/chores' : '/pot' })
  }, [hasFamily, navigate])

  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-3xl font-extrabold">{board?.familyName || 'Maestro'} 🎹</h1>
      <p className="text-sm font-semibold opacity-60">Chores your kids actually want to do, with a real stash they keep.</p>
    </div>
  )
}
