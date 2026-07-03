import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/utils";

// The palette tints from the design refs' chore-icon tiles. Each maps to a soft
// square fill + a saturated icon color so a duotone glyph reads clearly.
export type IconTileTint =
  | "green"
  | "blue"
  | "purple"
  | "gold"
  | "pink"
  | "sky"
  | "lilac"
  | "mint"
  | "butter"
  | "neutral";

const tintStyles: Record<IconTileTint, { tile: string; icon: string }> = {
  green: { tile: "bg-primary/20", icon: "text-m-green-ink" },
  blue: { tile: "bg-m-blue/15", icon: "text-m-blue" },
  purple: { tile: "bg-m-purple/15", icon: "text-m-purple" },
  gold: { tile: "bg-m-gold/25", icon: "text-[oklch(0.55_0.12_78)]" },
  pink: { tile: "bg-m-pink/20", icon: "text-m-pink" },
  sky: { tile: "bg-m-sky", icon: "text-m-blue" },
  lilac: { tile: "bg-m-lilac", icon: "text-m-purple" },
  mint: { tile: "bg-m-mint", icon: "text-m-green-ink" },
  butter: { tile: "bg-m-butter", icon: "text-[oklch(0.55_0.12_78)]" },
  neutral: { tile: "bg-muted", icon: "text-muted-foreground" },
};

// Rounded SQUARE tiles (radius ≈ 30% of the box, like the refs' chore icons).
// Explicit px radii: the theme's rounded-2xl is 32px, which turns these small
// boxes into circles — the wrong voice.
const sizeStyles = {
  sm: { box: "size-9 rounded-[11px]", icon: 18 },
  md: { box: "size-11 rounded-[13px]", icon: 22 },
  lg: { box: "size-14 rounded-[17px]", icon: 26 },
} as const;

interface IconTileProps {
  /** A Phosphor icon component (rendered duotone by default). */
  icon: Icon;
  tint?: IconTileTint;
  size?: keyof typeof sizeStyles;
  /** Phosphor weight — defaults to duotone (the refs' content-icon look). */
  weight?: "duotone" | "bold" | "fill" | "regular";
  /** Give the tile the card-pop outline (for standalone hero tiles). */
  bordered?: boolean;
  className?: string;
}

/**
 * A small rounded-square tinted tile wrapping a Phosphor icon — the refs put
 * every chore/section icon in one of these. One tile voice across the app.
 */
export function IconTile({
  icon: Icon,
  tint = "neutral",
  size = "md",
  weight = "duotone",
  bordered = false,
  className,
}: IconTileProps) {
  const t = tintStyles[tint];
  const s = sizeStyles[size];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        s.box,
        t.tile,
        bordered && "border-2 border-m-ink shadow-[var(--m-pop-sm)]",
        className,
      )}
    >
      <Icon className={t.icon} size={s.icon} weight={weight} />
    </span>
  );
}

/**
 * A tile that renders a user-chosen chore emoji instead of an icon (family
 * chores store an emoji per chore — we keep that working, in the same tile).
 */
export function EmojiTile({
  emoji,
  tint = "neutral",
  size = "md",
  bordered = false,
  className,
}: {
  emoji: string;
  tint?: IconTileTint;
  size?: keyof typeof sizeStyles;
  bordered?: boolean;
  className?: string;
}) {
  const t = tintStyles[tint];
  const s = sizeStyles[size];
  const emojiSize =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        s.box,
        t.tile,
        emojiSize,
        bordered && "border-2 border-m-ink shadow-[var(--m-pop-sm)]",
        className,
      )}
    >
      <span aria-hidden>{emoji}</span>
    </span>
  );
}
