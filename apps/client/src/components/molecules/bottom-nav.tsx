import { Link, useLocation } from "@tanstack/react-router";
import { HouseIcon, UsersIcon, SmileyIcon, type Icon } from "@phosphor-icons/react";
import { cn } from "@/utils";

type NavItem = {
  to: string;
  label: string;
  icon: Icon;
  match: (path: string) => boolean;
};

// Home / Family / Me — every tab answers a real question: mine / ours / me
// (DESIGN-STORY §4 nav survivor). Sibling routes fold into their home tab:
// rewards + the private-claim flow live under Home; the treasury feed and the
// old /circles + /history live under Family; /streams (allowance setup) is
// reached from Me → For grown-ups, so it lights up the Me tab.
const items: NavItem[] = [
  {
    to: "/dashboard",
    label: "Home",
    icon: HouseIcon,
    match: (p) => p === "/dashboard" || p.startsWith("/rewards"),
  },
  {
    to: "/family",
    label: "Family",
    icon: UsersIcon,
    match: (p) =>
      p.startsWith("/family") ||
      p.startsWith("/circles") ||
      p.startsWith("/history"),
  },
  {
    to: "/me",
    label: "Me",
    icon: SmileyIcon,
    match: (p) =>
      p.startsWith("/me") ||
      p.startsWith("/settings") ||
      p.startsWith("/streams"),
  },
];

export function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
      aria-label="Primary"
    >
      <div className="flex items-center justify-around rounded-[1.75rem] border-2 border-m-ink bg-card p-1.5 shadow-[var(--m-pop)]">
        {items.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group press-pop relative flex min-w-[4.5rem] flex-col items-center gap-1 rounded-[1.4rem] px-4 py-2",
                active
                  ? "border-2 border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop-sm)]"
                  : "border-2 border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                size={24}
                weight={active ? "fill" : "bold"}
                className={cn(
                  "transition-transform duration-200",
                  active ? "scale-105" : "[@media(hover:hover)]:group-hover:scale-105",
                )}
              />
              <span className="text-[11px] font-extrabold tracking-tight">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
