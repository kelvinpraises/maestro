import { Gift } from "lucide-react";
import { cn } from "@/utils";

interface GoalProgressProps {
  /** What the kid is saving for, e.g. "Nintendo Switch" */
  goalName: string;
  saved: number;
  target: number;
  emoji?: string;
  className?: string;
}

/**
 * The "SAVING FOR… $X" card with a chunky progress bar and a gold "N% there!"
 * pill. Big tabular money, playful rounded surfaces.
 */
export function GoalProgress({
  goalName,
  saved,
  target,
  emoji = "🎮",
  className,
}: GoalProgressProps) {
  const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;

  return (
    <div
      className={cn(
        "animate-pop-in rounded-3xl border border-border/60 bg-card p-5 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-m-sky text-lg shadow-sm">
          {emoji ? <span aria-hidden>{emoji}</span> : <Gift className="size-4 text-m-blue" />}
        </span>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
          Saving for: <span className="text-foreground">{goalName}</span>
        </p>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <span className="font-display text-4xl font-extrabold leading-none tabular-nums text-primary">
          ${saved.toFixed(2)}
        </span>
        <span className="pb-1 text-sm font-bold text-muted-foreground tabular-nums">
          / ${target.toFixed(2)}
        </span>
      </div>

      <div className="mt-3 h-3.5 w-full overflow-hidden rounded-full bg-primary/15">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-m-gold/30 px-3 py-1 text-xs font-extrabold text-[oklch(0.5_0.12_78)]">
          ⭐ {pct}% there!
        </span>
      </div>
    </div>
  );
}
