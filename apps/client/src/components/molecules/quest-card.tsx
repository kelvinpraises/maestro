// Ported verbatim from maestro-redacted molecules/quest-card. Only delta:
// currency label STRK (invariant I1).
import type { Icon } from '@phosphor-icons/react'
import { CheckIcon, CaretRightIcon, ClockIcon } from '@phosphor-icons/react'
import { EmojiTile } from '@/components/atoms/icon-tile'
import { cn } from '@/utils'

export type QuestTint = 'blue' | 'green' | 'pink' | 'purple' | 'gold'
export type QuestStatus = 'todo' | 'pending' | 'done'

interface QuestCardProps {
  title: string
  /** Reward amount in STRK, e.g. 2 */
  amount: number
  icon: Icon
  emoji?: string
  note?: string
  tint?: QuestTint
  status?: QuestStatus
  onClick?: () => void
  className?: string
}

const tintStyles: Record<QuestTint, { card: string; iconTint: 'blue' | 'green' | 'pink' | 'purple' | 'gold' }> = {
  blue: { card: 'card-pop-sky', iconTint: 'blue' },
  green: { card: 'card-pop-mint', iconTint: 'green' },
  pink: { card: 'card-pop-pink', iconTint: 'pink' },
  purple: { card: 'card-pop-lilac', iconTint: 'purple' },
  gold: { card: 'card-pop-butter', iconTint: 'gold' },
}

export function QuestCard({ title, amount, icon: Icon, emoji, note, tint = 'blue', status = 'todo', onClick, className }: QuestCardProps) {
  const t = tintStyles[tint]
  const done = status === 'done'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group press-pop card-pop flex w-full items-center gap-3.5 p-3 text-left',
        done ? 'card-pop-mint opacity-60' : t.card,
        className,
      )}
    >
      {emoji ? (
        <EmojiTile emoji={emoji} tint={t.iconTint} size="lg" bordered />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-[17px] border-2 border-[var(--m-ink)] bg-white/70 shadow-[var(--m-pop-sm)]">
          <Icon className="size-6 text-[var(--m-foreground)]" weight="duotone" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-display text-[15px] font-bold text-[var(--m-foreground)]', done && 'opacity-60 line-through decoration-2')}>
          {title}
        </p>
        {note && <p className="truncate text-[12px] font-semibold opacity-60">{note}</p>}
        {!done && (
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-[var(--m-ink)]/25 bg-white/70 px-2 py-0.5 text-[13px] font-extrabold text-[var(--m-green-ink)] tabular-nums">
            +{amount.toFixed(2)} STRK
          </span>
        )}
      </div>

      <div className="shrink-0 pr-1">
        {status === 'pending' ? (
          <span className="inline-flex items-center gap-1 rounded-full border-2 border-[var(--m-ink)] bg-white/85 px-2.5 py-1 text-[11px] font-extrabold text-[oklch(0.55_0.12_78)]">
            <ClockIcon className="size-3" weight="bold" />
            Pending
          </span>
        ) : done ? (
          <span className="flex size-7 items-center justify-center rounded-full border-2 border-[var(--m-ink)]/40 bg-[var(--m-mint)]/60 text-[var(--m-green-ink)]">
            <CheckIcon className="size-4" weight="bold" />
          </span>
        ) : (
          <span className="flex size-9 items-center justify-center rounded-full border-2 border-[var(--m-ink)] bg-white text-[var(--m-foreground)] shadow-[var(--m-pop-sm)] transition-transform duration-200 [@media(hover:hover)]:group-hover:translate-x-0.5">
            <CaretRightIcon className="size-5" weight="bold" />
          </span>
        )}
      </div>
    </button>
  )
}
