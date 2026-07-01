import { Link, useLocation } from "@tanstack/react-router";
import { ScrollText, PiggyBank, Smile } from "lucide-react";
import { cn } from "@/utils";

type NavItem = {
  to: string;
  label: string;
  icon: typeof ScrollText;
  match: (path: string) => boolean;
};

const items: NavItem[] = [
  {
    to: "/dashboard",
    label: "Quests",
    icon: ScrollText,
    match: (p) => p === "/dashboard" || p.startsWith("/streams") || p.startsWith("/history"),
  },
  {
    to: "/yieldbox",
    label: "Store",
    icon: PiggyBank,
    match: (p) => p.startsWith("/yieldbox"),
  },
  {
    to: "/settings",
    label: "Me",
    icon: Smile,
    match: (p) => p.startsWith("/settings") || p.startsWith("/circles") || p.startsWith("/contacts") || p.startsWith("/wallet") || p.startsWith("/proposals"),
  },
];

export function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
      aria-label="Primary"
    >
      <div className="flex items-center justify-around rounded-[1.75rem] border border-border/60 bg-card/90 p-1.5 shadow-lg backdrop-blur-xl">
        {items.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex min-w-[4.5rem] flex-col items-center gap-1 rounded-[1.4rem] px-4 py-2 transition-[background-color,color] duration-200",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-5 transition-transform duration-200",
                  active ? "scale-110" : "group-hover:scale-105",
                )}
                strokeWidth={2.4}
              />
              <span className="text-[11px] font-bold tracking-tight">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
