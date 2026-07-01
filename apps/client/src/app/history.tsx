import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bed, Trash2, Utensils, Dog, CheckCircle2, ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocalStreams } from "@/store/stream-store";

export const Route = createFileRoute("/history")({
  component: CompletedChoresPage,
});

type DoneChore = {
  id: string;
  title: string;
  amount: number;
  icon: LucideIcon;
  emoji: string;
  when: string;
};

// Sample completed chores — shown when there's no real activity yet.
const SAMPLE_DONE: DoneChore[] = [
  { id: "d1", title: "Make the Bed", amount: 2, icon: Bed, emoji: "🛏️", when: "Today" },
  { id: "d2", title: "Wash Dishes", amount: 1.5, icon: Utensils, emoji: "🍽️", when: "Today" },
  { id: "d3", title: "Take out Trash", amount: 1, icon: Trash2, emoji: "🗑️", when: "Yesterday" },
  { id: "d4", title: "Walk the Dog", amount: 2.5, icon: Dog, emoji: "🐕", when: "Yesterday" },
  { id: "d5", title: "Make the Bed", amount: 2, icon: Bed, emoji: "🛏️", when: "Mon" },
];

function CompletedChoresPage() {
  const navigate = useNavigate();
  const { streams } = useLocalStreams();

  // Map real streams onto the "completed chore" shape when available.
  const done: DoneChore[] = useMemo(() => {
    if (streams.length === 0) return SAMPLE_DONE;
    return streams.map((s, i) => ({
      id: s.id,
      title: `${s.tokenSymbol} Reward`,
      amount: parseFloat(s.totalAmount || "0"),
      icon: [Bed, Utensils, Trash2, Dog][i % 4],
      emoji: ["🛏️", "🍽️", "🗑️", "🐕"][i % 4],
      when: new Date(s.createdAt).toLocaleDateString(),
    }));
  }, [streams]);

  const total = done.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="stagger-rise space-y-5">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/dashboard" })}
          aria-label="Back"
          className="flex size-11 items-center justify-center rounded-2xl border border-border/60 bg-card text-foreground shadow-sm transition-transform active:scale-95"
        >
          <ArrowLeft className="size-5" strokeWidth={2.4} />
        </button>
        <div>
          <h1 className="font-display text-2xl font-extrabold leading-tight">All Done!</h1>
          <p className="text-sm font-semibold text-muted-foreground">Chores you've crushed</p>
        </div>
      </header>

      {/* This-week total */}
      <div className="animate-pop-in flex items-center justify-between rounded-3xl bg-primary p-5 text-primary-foreground shadow-lg">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-primary-foreground/70">
            Earned so far
          </p>
          <p className="font-display text-4xl font-extrabold leading-none tabular-nums">
            ${total.toFixed(2)}
          </p>
        </div>
        <span className="text-4xl" aria-hidden>🏅</span>
      </div>

      {/* Completed list */}
      <div className="space-y-2.5">
        {done.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-3 rounded-[1.6rem] border border-border/60 bg-card p-3 shadow-sm"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-m-mint text-xl shadow-sm">
              <span aria-hidden>{d.emoji}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[15px] font-bold text-foreground">
                {d.title}
              </p>
              <p className="text-xs font-semibold text-muted-foreground">{d.when}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-display text-base font-extrabold tabular-nums text-m-green-ink">
                +${d.amount.toFixed(2)}
              </span>
              <CheckCircle2 className="size-5 text-primary" strokeWidth={2.4} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
