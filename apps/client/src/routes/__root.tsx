import { Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { BottomNav } from '#/components/BottomNav'
import { currentRole } from '#/lib/family'
import { Toasts } from '#/lib/toast'
import '../styles.css'

export const Route = createRootRoute({
  component: RootLayout,
})

// Shell ported from maestro-redacted's __root:
//   fullscreen entry routes render bare; everything else sits in the
//   phone-width canvas column with the playful bottom nav. No header chrome —
//   the original never had one; wallet access lives inside screens.
const FULLSCREEN = ['/welcome', '/setup', '/join']

function RootLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const isFullscreenRoute = FULLSCREEN.some((p) => location.pathname.startsWith(p))
  const hasFamily = typeof window !== 'undefined' && !!localStorage.getItem('maestro.board.familyId')

  // A device WITH a family never sees the entry doors again (redacted guard).
  useEffect(() => {
    if (hasFamily && isFullscreenRoute && !location.pathname.startsWith('/join')) {
      void navigate({ to: currentRole() === 'kid' ? '/dashboard' : '/dashboard' })
    }
  }, [hasFamily, isFullscreenRoute, location.pathname, navigate])

  if (isFullscreenRoute) {
    return (
      <div className="bg-maestro-canvas min-h-dvh w-full">
        <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 py-10">
          <Outlet />
        </div>
        <Toasts />
      </div>
    )
  }

  return (
    <div className="bg-maestro-canvas min-h-dvh w-full">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col">
        <main className="flex-1 px-5 pb-32 pt-6">
          <Outlet />
        </main>
        <BottomNav />
      </div>
      <Toasts />
    </div>
  )
}
