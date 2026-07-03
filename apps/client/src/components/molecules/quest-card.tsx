import type { Icon } from "@phosphor-icons/react";
import { CheckIcon, CaretRightIcon, ClockIcon } from "@phosphor-icons/react";
import { EmojiTile } from "@/components/atoms/icon-tile";
import { cn } from "@/utils";

export type QuestTint = "blue" | "green" | "pink" | "purple" | "gold";
export type QuestStatus = "todo" | "pending" | "done";

interface QuestCardProps {
  title: string;
  /** Reward amount in XLM, e.g. 2 */
  amount: number;
  icon: Icon;
  /** Emoji shown instead of/alongside an icon for extra playfulness */
  emoji?: string;
  tint?: QuestTint;
  status?: QuestStatus;
  onClick?: () => void;
  className?: string;
}

// Each quest tint = one card-pop flat-fill (the refs' pastel chore rows).
const tintStyles: Record<
  QuestTint,
  { card: string; iconTint: "blue" | "green" | "pink" | "purple" | "gold" }
> = {
  blue: { card: "card-pop-sky", iconTint: "blue" },
  green: { card: "card-pop-mint", iconTint: "green" },
  pink: { card: "card-pop-pink", iconTint: "pink" },
  purple: { card: "card-pop-lilac", iconTint: "purple" },
  gold: { card: "card-pop-butter", iconTint: "gold" },
};

/**
 * A single pastel quest/chore row for the kid home screen. Chunky card-pop
 * outline, a tinted icon/emoji tile, a coin reward pill, and a status
 * affordance on the right.
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
        "group press-pop card-pop flex w-full items-center gap-3.5 p-3 text-left",
        t.card,
        done && "opacity-70",
        className,
      )}
    >
      {/* icon / emoji tile */}
      {emoji ? (
        <EmojiTile emoji={emoji} tint={t.iconTint} size="lg" bordered />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-[17px] border-2 border-m-ink bg-white/70 shadow-[var(--m-pop-sm)]">
          <Icon className="size-6 text-foreground" weight="duotone" />
        </span>
      )}

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
        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-m-ink/25 bg-white/70 px-2 py-0.5 text-[13px] font-extrabold text-m-green-ink tabular-nums">
          +{amount.toFixed(2)} XLM
        </span>
      </div>

      {/* status affordance */}
      <div className="shrink-0 pr-1">
        {status === "pending" ? (
          <span className="inline-flex items-center gap-1 rounded-full border-2 border-m-ink bg-white/85 px-2.5 py-1 text-[11px] font-extrabold text-[oklch(0.55_0.12_78)]">
            <ClockIcon className="size-3" weight="bold" />
            Pending
          </span>
        ) : done ? (
          <span className="flex size-9 items-center justify-center rounded-full border-2 border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop-sm)]">
            <CheckIcon className="size-5" weight="bold" />
          </span>
        ) : (
          <span className="flex size-9 items-center justify-center rounded-full border-2 border-m-ink bg-white text-foreground shadow-[var(--m-pop-sm)] transition-transform duration-200 group-hover:translate-x-0.5">
            <CaretRightIcon className="size-5" weight="bold" />
          </span>
        )}
      </div>
    </button>
  );
}
