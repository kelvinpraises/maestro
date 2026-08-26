import { Outlet, createRootRoute } from '@tanstack/react-router'

import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { WalletButton } from '#/components/WalletButton'
import '../styles.css'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
      <header className="mx-auto flex max-w-[390px] items-center justify-between px-4 py-3">
        <nav className="flex gap-3 text-sm font-extrabold">
          <a href="/pot" className="hover:underline">Pot</a>
          <a href="/chores" className="hover:underline">Chores</a>
          <a href="/dev/board" className="text-xs opacity-50 hover:underline">dev·board</a>
          <a href="/dev/money" className="text-xs opacity-50 hover:underline">dev·money</a>
        </nav>
        <WalletButton />
      </header>
      <main className="mx-auto max-w-[390px] px-4 pb-10">
        <Outlet />
      </main>
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
