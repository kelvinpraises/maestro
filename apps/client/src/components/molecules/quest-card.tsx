import type { LucideIcon } from "lucide-react";
import { Check, ChevronRight, Clock3 } from "lucide-react";
import { cn } from "@/utils";

export type QuestTint = "blue" | "green" | "pink" | "purple" | "gold";
export type QuestStatus = "todo" | "pending" | "done";

interface QuestCardProps {
  title: string;
  /** Reward amount in dollars, e.g. 2 */
  amount: number;
  icon: LucideIcon;
  /** Emoji shown instead of/alongside a lucide icon for extra playfulness */
  emoji?: string;
  tint?: QuestTint;
  status?: QuestStatus;
  onClick?: () => void;
  className?: string;
}

const tintStyles: Record<
  QuestTint,
  { card: string; tile: string; icon: string }
> = {
  blue: {
    card: "bg-m-sky",
    tile: "bg-m-blue/15",
    icon: "text-m-blue",
  },
  green: {
    card: "bg-m-mint",
    tile: "bg-primary/20",
    icon: "text-m-green-ink",
  },
  pink: {
    card: "bg-m-blush",
    tile: "bg-m-pink/20",
    icon: "text-m-pink",
  },
  purple: {
    card: "bg-m-lilac",
    tile: "bg-m-purple/15",
    icon: "text-m-purple",
  },
  gold: {
    card: "bg-m-butter",
    tile: "bg-m-gold/25",
    icon: "text-[oklch(0.55_0.12_78)]",
  },
};

/**
 * A single pastel quest/chore row for the kid home screen. Colored icon tile,
 * title, a coin reward pill, and a status affordance on the right.
 */
export function QuestCard({
  title,
  amount,
  icon: Icon,
  emoji,
  tint = "blue",
  status = "todo",
  onClick,
  className,
}: QuestCardProps) {
  const t = tintStyles[tint];
  const done = status === "done";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3.5 rounded-[1.6rem] p-3 text-left shadow-sm ring-1 ring-black/[0.03] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.985]",
        t.card,
        done && "opacity-70",
        className,
      )}
    >
      {/* icon tile */}
      <div
        className={cn(
          "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/70 text-2xl shadow-sm",
        )}
      >
        {emoji ? (
          <span aria-hidden>{emoji}</span>
        ) : (
          <span className={cn("flex size-9 items-center justify-center rounded-xl", t.tile)}>
            <Icon className={cn("size-5", t.icon)} strokeWidth={2.4} />
          </span>
        )}
      </div>

      {/* title + reward */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate font-display text-[15px] font-bold text-foreground",
            done && "line-through decoration-2",
          )}
        >
          {title}
        </p>
        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[13px] font-extrabold text-m-green-ink tabular-nums">
          +${amount.toFixed(2)}
        </span>
      </div>

      {/* status affordance */}
      <div className="shrink-0 pr-1">
        {status === "pending" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-extrabold text-[oklch(0.55_0.12_78)]">
            <Clock3 className="size-3" strokeWidth={2.6} />
            Pending
          </span>
        ) : done ? (
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Check className="size-5" strokeWidth={3} />
          </span>
        ) : (
          <span className="flex size-9 items-center justify-center rounded-full bg-white text-foreground shadow-sm transition-transform duration-200 group-hover:translate-x-0.5">
            <ChevronRight className="size-5" strokeWidth={2.8} />
          </span>
        )}
      </div>
    </button>
  );
}
