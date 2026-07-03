import { FlameIcon } from "@phosphor-icons/react";
import { cn } from "@/utils";

interface EarningsHeroProps {
  /** XLM amount claimed this week, e.g. 12.5 */
  amount: number;
  /** Streak length in days */
  streakDays: number;
  /** Small eyebrow label above the number */
  label?: string;
  className?: string;
}

/**
 * The bright-green "EARNED THIS WEEK · N-day streak" hero card that anchors the
 * kid home screen. Big tabular money, a chunky streak pill, and a soft green
 * glow. Mirrors the Maestro design ref.
 */
export function EarningsHero({
  amount,
  streakDays,
  label = "Earned this week",
  className,
}: EarningsHeroProps) {
  return (
    <div
      className={cn(
        // card-pop-green: saturated green fill wins over card-pop's cream base
        // (plain bg-primary is overridden by the recipe's background).
        "animate-pop-in card-pop card-pop-green card-pop-lg relative overflow-hidden p-5 text-primary-foreground",
        className,
      )}
    >
      <div className="relative">
        <p className="text-microlabel text-primary-foreground/70">
          {label}
        </p>
        <div className="mt-1 flex items-end gap-1.5">
          <span className="text-money text-5xl leading-none">
            {amount.toFixed(2)}
          </span>
          <span className="pb-1 font-display text-xl font-extrabold leading-none text-primary-foreground/80">
            XLM
          </span>
        </div>

        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border-2 border-m-ink bg-m-butter px-3 py-1.5 text-foreground">
          <FlameIcon className="size-4 text-[oklch(0.62_0.19_45)]" weight="fill" />
          <span className="text-sm font-extrabold">
            {streakDays}-day streak
          </span>
        </div>
      </div>
    </div>
  );
}
