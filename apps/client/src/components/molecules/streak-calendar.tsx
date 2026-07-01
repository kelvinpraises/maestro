import { cn } from "@/utils";

interface StreakCalendarProps {
  /** Number of consecutive active days to fill (from the start) */
  activeDays: number;
  /** Total dots to render */
  totalDays?: number;
  /** Index (0-based) that shows a coin milestone instead of a plain dot */
  milestoneIndex?: number;
  longestStreak?: number;
  className?: string;
}

/**
 * A dot-calendar showing the kid's streak — filled green dots for completed
 * days, a coin on a milestone, hollow dots for upcoming days.
 */
export function StreakCalendar({
  activeDays,
  totalDays = 21,
  milestoneIndex,
  longestStreak,
  className,
}: StreakCalendarProps) {
  const dots = Array.from({ length: totalDays });

  return (
    <div
      className={cn(
        "rounded-3xl border border-border/60 bg-card p-5 shadow-sm",
        className,
      )}
    >
      <div className="grid grid-cols-7 gap-2.5">
        {dots.map((_, i) => {
          const active = i < activeDays;
          const isMilestone = milestoneIndex === i;
          if (isMilestone) {
            return (
              <div
                key={i}
                className="flex aspect-square items-center justify-center rounded-full bg-m-gold/30 text-sm shadow-inner"
                aria-label="Milestone reward"
              >
                🪙
              </div>
            );
          }
          return (
            <div
              key={i}
              className={cn(
                "aspect-square rounded-full transition-colors",
                active
                  ? "bg-primary shadow-sm"
                  : "border-2 border-dashed border-border bg-transparent",
              )}
            />
          );
        })}
      </div>

      {longestStreak !== undefined && (
        <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
          <span className="text-sm font-bold text-muted-foreground">
            Longest streak
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-sm font-extrabold text-m-green-ink tabular-nums">
            🔥 {longestStreak} days
          </span>
        </div>
      )}
    </div>
  );
}
