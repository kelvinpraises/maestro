// Bottom nav — ported verbatim from maestro-redacted's molecules/bottom-nav.
// Three tabs, each answers a question: Home (mine) / Family (ours) / Me.
// Parent tools (/allowance) fold under Home; family admin under Family.
import { Link, useLocation } from '@tanstack/react-router'
import { HouseIcon, UsersIcon, SmileyIcon, type Icon } from '@phosphor-icons/react'

type NavItem = {
  to: string
  label: string
  icon: Icon
  match: (path: string) => boolean
}

const items: NavItem[] = [
  {
    to: '/dashboard',
    label: 'Home',
    icon: HouseIcon,
    match: (p) =>
      p === '/dashboard' ||
      p.startsWith('/chores') ||
      p.startsWith('/allowance') ||
      p.startsWith('/pot'),
  },
  {
    to: '/family',
    label: 'Family',
    icon: UsersIcon,
    match: (p) => p.startsWith('/family') || p.startsWith('/goals'),
  },
  {
    to: '/me',
    label: 'Me',
    icon: SmileyIcon,
    match: (p) => p.startsWith('/me') || p.startsWith('/stash'),
  },
]

export function BottomNav() {
  const { pathname } = useLocation()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
      aria-label="Primary"
    >
      <div className="card-pop flex items-center justify-around !p-1.5" style={{ borderRadius: '1.75rem' }}>
        {items.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname)
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              className={`press-pop relative flex min-w-[4.5rem] flex-col items-center gap-1 rounded-[1.4rem] border-2 px-4 py-2 ${
                active
                  ? 'border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)]'
                  : 'border-transparent text-[var(--muted-foreground)]'
              }`}
            >
              <Icon size={24} weight={active ? 'fill' : 'bold'} />
              <span className="text-[11px] font-extrabold tracking-tight">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
