// Ported verbatim from maestro-redacted atoms/icon-tile.
import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/utils'

export type IconTileTint =
  | 'green' | 'blue' | 'purple' | 'gold' | 'pink' | 'sky' | 'lilac' | 'mint' | 'butter' | 'neutral'

const tintStyles: Record<IconTileTint, { tile: string; icon: string }> = {
  green: { tile: 'bg-[color-mix(in_oklab,var(--m-green)_20%,white)]', icon: 'text-[var(--m-green-ink)]' },
  blue: { tile: 'bg-[var(--m-sky)]', icon: 'text-[var(--m-blue)]' },
  purple: { tile: 'bg-[var(--m-lilac)]', icon: 'text-[var(--m-purple)]' },
  gold: { tile: 'bg-[var(--m-gold)]/25', icon: 'text-[oklch(0.55_0.12_78)]' },
  pink: { tile: 'bg-[var(--m-blush)]', icon: 'text-[var(--m-pink)]' },
  sky: { tile: 'bg-[var(--m-sky)]', icon: 'text-[var(--m-blue)]' },
  lilac: { tile: 'bg-[var(--m-lilac)]', icon: 'text-[var(--m-purple)]' },
  mint: { tile: 'bg-[var(--m-mint)]', icon: 'text-[var(--m-green-ink)]' },
  butter: { tile: 'bg-[var(--m-butter)]', icon: 'text-[oklch(0.55_0.12_78)]' },
  neutral: { tile: 'bg-[var(--m-lavender)]', icon: 'opacity-60' },
}

const sizeStyles = {
  sm: { box: 'size-9 rounded-[11px]', icon: 18 },
  md: { box: 'size-11 rounded-[13px]', icon: 22 },
  lg: { box: 'size-14 rounded-[17px]', icon: 26 },
} as const

interface IconTileProps {
  icon: Icon
  tint?: IconTileTint
  size?: keyof typeof sizeStyles
  weight?: 'duotone' | 'bold' | 'fill' | 'regular'
  bordered?: boolean
  className?: string
}

export function IconTile({ icon: I, tint = 'neutral', size = 'md', weight = 'duotone', bordered, className }: IconTileProps) {
  const { box, icon: iconSize } = sizeStyles[size]
  const { tile, icon: iconColor } = tintStyles[tint]
  return (
    <span className={cn('flex shrink-0 items-center justify-center', box, tile, bordered && 'border-2 border-[var(--m-ink)] shadow-[var(--m-pop-sm)]', className)}>
      <I size={iconSize} weight={weight} className={iconColor} />
    </span>
  )
}

export function EmojiTile({
  emoji,
  tint = 'neutral',
  size = 'md',
  bordered = false,
  className,
}: {
  emoji: string
  tint?: IconTileTint
  size?: keyof typeof sizeStyles
  bordered?: boolean
  className?: string
}) {
  const t = tintStyles[tint]
  const s = sizeStyles[size]
  const emojiSize = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-xl'
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center',
        s.box, t.tile, emojiSize,
        bordered && 'border-2 border-[var(--m-ink)] shadow-[var(--m-pop-sm)]',
        className,
      )}
    >
      <span aria-hidden>{emoji}</span>
    </span>
  )
}
