import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { GoalProgress } from "@/components/molecules/goal-progress";
import { StreakCalendar } from "@/components/molecules/streak-calendar";
import { useYieldSummary } from "@/hooks/use-yield-positions";

export const Route = createFileRoute("/yieldbox/")({
  component: MyGoalsPage,
});

// Sample savings goals (presentational). The contract-wiring workstream maps
// these onto real balances / vault positions.
const GOALS = [
  { id: "switch", name: "Nintendo Switch", target: 299.99, emoji: "🎮" },
  { id: "bike", name: "New Bike", target: 180, emoji: "🚲" },
];

function MyGoalsPage() {
  // Real savings value when available, else a friendly sample.
  const { data: yieldSummary } = useYieldSummary();
  const saved = useMemo(() => {
    if (yieldSummary?.totalPrincipal && yieldSummary.totalPrincipal > 0n) {
      return parseFloat(formatUnits(yieldSummary.totalPrincipal, 6));
    }
    return 87.5;
  }, [yieldSummary]);

  const primaryGoal = GOALS[0];

  return (
    <div className="stagger-rise space-y-5">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">My Goals</h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          Watch your savings grow toward something awesome.
        </p>
      </header>

      {/* Primary goal */}
      <GoalProgress
        goalName={primaryGoal.name}
        saved={saved}
        target={primaryGoal.target}
        emoji={primaryGoal.emoji}
      />

      {/* Streak */}
      <section className="space-y-3">
        <h2 className="px-1 font-display text-lg font-extrabold">Your Streak</h2>
        <StreakCalendar activeDays={12} totalDays={21} milestoneIndex={13} longestStreak={12} />
      </section>

      {/* Other goals */}
      <section className="space-y-3">
        <h2 className="px-1 font-display text-lg font-extrabold">Saving up next</h2>
        <div className="space-y-2.5">
          {GOALS.slice(1).map((g) => {
            const pct = Math.min(100, Math.round((saved / g.target) * 100));
            return (
              <div
                key={g.id}
                className="flex items-center gap-3 rounded-[1.6rem] border border-border/60 bg-card p-3 shadow-sm"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-m-sky text-xl shadow-sm">
                  <span aria-hidden>{g.emoji}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[15px] font-bold text-foreground">
                    {g.name}
                  </p>
                  <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-primary/15">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs font-extrabold tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
