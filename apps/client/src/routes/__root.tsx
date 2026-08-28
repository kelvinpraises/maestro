import { Outlet, createRootRoute } from '@tanstack/react-router'

import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { WalletButton } from '#/components/WalletButton'
import { useBoard } from '#/lib/useBoard'
import { currentRole } from '#/lib/family'
import { Toasts } from '#/lib/toast'
import '../styles.css'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const { syncing } = useBoard()
  return (
    <>
      <header className="mx-auto flex max-w-[390px] items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <a href="/" className="font-display text-lg font-extrabold">{useBoard().board?.familyName || 'Maestro'}</a>
          {syncing && (
            <span className="animate-pulse rounded-full border-2 border-[var(--m-ink)] bg-[var(--m-gold)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider">
              syncing…
            </span>
          )}
        </div>
        <WalletButton />
      </header>
      <main className="mx-auto max-w-[390px] px-4 pb-24">
        <Outlet />
      </main>
      <TabBar />
      <Toasts />
      <TanStackDevtools
        config={{
          position: 'bottom-right',
        }}
        plugins={[
          {
            name: 'TanStack Router',
            render: <TanStackRouterDevtoolsPanel />,
          },
        ]}
      />
    </>
  )
}

/** Role-aware bottom tab bar — the redacted app's nav voice. */
function TabBar() {
  const kid = currentRole() === 'kid'
  const tabs = kid
    ? [
        { href: '/chores', label: 'Chores' },
        { href: '/stash', label: 'Stash' },
        { href: '/goals', label: 'Goals' },
      ]
    : [
        { href: '/pot', label: 'Pot' },
        { href: '/allowance', label: 'Allowance' },
        { href: '/goals', label: 'Goals' },
      ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[390px] px-3 pb-3">
      <div className="card-pop flex justify-around !py-2">
        {tabs.map((t) => (
          <a key={t.href} href={t.href} className="text-sm font-extrabold hover:underline">
            {t.label}
          </a>
        ))}
      </div>
    </nav>
  )
}
