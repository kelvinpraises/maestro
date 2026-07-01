import { Flame } from "lucide-react";
import { cn } from "@/utils";

interface EarningsHeroProps {
  /** Dollar amount earned this week, e.g. 12.5 */
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
        "animate-pop-in relative overflow-hidden rounded-3xl bg-primary p-5 text-primary-foreground shadow-lg",
        className,
      )}
    >
      {/* playful soft light blobs */}
      <div className="pointer-events-none absolute -right-8 -top-10 size-36 rounded-full bg-white/20 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-6 size-32 rounded-full bg-white/10 blur-2xl" />

      <div className="relative">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-primary-foreground/70">
          {label}
        </p>
        <div className="mt-1 flex items-end gap-1">
          <span className="font-display text-5xl font-extrabold leading-none tabular-nums">
            ${amount.toFixed(2)}
          </span>
        </div>

        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-black/15 px-3 py-1.5">
          <Flame className="size-4 text-m-gold" strokeWidth={2.6} />
          <span className="text-sm font-extrabold">
            {streakDays}-day streak
          </span>
        </div>
      </div>
    </div>
  );
}
