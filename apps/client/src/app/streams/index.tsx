import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Bed, Trash2, Utensils, Dog, Sparkles, Plus, Minus, ArrowRight, Pencil } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils";

export const Route = createFileRoute("/streams/")({
  component: SetupChoresPage,
});

type Chore = {
  id: string;
  title: string;
  amount: number;
  icon: LucideIcon;
  emoji: string;
  tint: "blue" | "green" | "pink" | "purple";
  enabled: boolean;
};

const TINT: Record<Chore["tint"], { tile: string; icon: string }> = {
  blue: { tile: "bg-m-sky", icon: "text-m-blue" },
  green: { tile: "bg-m-mint", icon: "text-m-green-ink" },
  pink: { tile: "bg-m-blush", icon: "text-m-pink" },
  purple: { tile: "bg-m-lilac", icon: "text-m-purple" },
};

const INITIAL_CHORES: Chore[] = [
  { id: "bed", title: "Make the Bed", amount: 2, icon: Bed, emoji: "🛏️", tint: "blue", enabled: true },
  { id: "trash", title: "Take out Trash", amount: 1, icon: Trash2, emoji: "🗑️", tint: "purple", enabled: true },
  { id: "dishes", title: "Wash Dishes", amount: 1.5, icon: Utensils, emoji: "🍽️", tint: "pink", enabled: true },
  { id: "dog", title: "Walk the Dog", amount: 2.5, icon: Dog, emoji: "🐕", tint: "green", enabled: false },
];

function SetupChoresPage() {
  const navigate = useNavigate();
  const [chores, setChores] = useState<Chore[]>(INITIAL_CHORES);

  const adjust = (id: string, delta: number) =>
    setChores((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, amount: Math.max(0, Math.round((c.amount + delta) * 100) / 100) } : c,
      ),
    );

  const toggle = (id: string) =>
    setChores((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));

  const weeklyTotal = chores
    .filter((c) => c.enabled)
    .reduce((sum, c) => sum + c.amount, 0);

  return (
    <div className="stagger-rise space-y-5">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Chores &amp; Rewards
        </h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          Pick the chores and set what each one is worth. You can change these
          anytime.
        </p>
      </header>

      {/* Weekly total pill */}
      <div className="flex items-center justify-between rounded-3xl bg-primary/10 px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm font-extrabold text-m-green-ink">
          <Sparkles className="size-4" strokeWidth={2.6} />
          Up to this week
        </span>
        <span className="font-display text-xl font-extrabold tabular-nums text-m-green-ink">
          ${weeklyTotal.toFixed(2)}
        </span>
      </div>

      {/* Chore list */}
      <div className="space-y-2.5">
        {chores.map((c) => {
          const t = TINT[c.tint];
          return (
            <div
              key={c.id}
              className={cn(
                "flex items-center gap-3 rounded-[1.6rem] border border-border/60 bg-card p-3 shadow-sm transition-opacity",
                !c.enabled && "opacity-55",
              )}
            >
              <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl text-xl shadow-sm", t.tile)}>
                <span aria-hidden>{c.emoji}</span>
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-bold text-foreground">
                  {c.title}
                </p>
                <span className="text-[13px] font-extrabold tabular-nums text-m-green-ink">
                  ${c.amount.toFixed(2)}
                </span>
              </div>

              {/* stepper */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`Decrease ${c.title} reward`}
                  onClick={() => adjust(c.id, -0.5)}
                  className="flex size-8 items-center justify-center rounded-full bg-muted text-foreground transition-transform active:scale-90"
                >
                  <Minus className="size-4" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  aria-label={`Increase ${c.title} reward`}
                  onClick={() => adjust(c.id, 0.5)}
                  className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-90"
                >
                  <Plus className="size-4" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  aria-label={c.enabled ? `Turn off ${c.title}` : `Turn on ${c.title}`}
                  onClick={() => toggle(c.id)}
                  className={cn(
                    "ml-1 flex size-8 items-center justify-center rounded-full shadow-sm transition-transform active:scale-90",
                    c.enabled ? "bg-primary text-primary-foreground" : "border-2 border-border bg-card text-muted-foreground",
                  )}
                >
                  <Pencil className="size-3.5" strokeWidth={2.6} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add custom chore */}
      <button
        type="button"
        onClick={() =>
          setChores((prev) => [
            ...prev,
            {
              id: `custom-${prev.length}`,
              title: "Custom Chore",
              amount: 1,
              icon: Sparkles,
              emoji: "✨",
              tint: "green",
              enabled: true,
            },
          ])
        }
        className="flex w-full items-center justify-center gap-2 rounded-[1.6rem] border-2 border-dashed border-border bg-card/60 p-3.5 font-display text-sm font-extrabold text-muted-foreground transition-colors hover:text-foreground active:scale-[0.99]"
      >
        <Plus className="size-4" strokeWidth={2.8} />
        Add Custom Chore
      </button>

      {/* Continue to invite */}
      <button
        type="button"
        onClick={() => navigate({ to: "/circles/join", search: {} })}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-m-purple font-display text-lg font-extrabold text-white shadow-lg transition-[transform,filter] hover:brightness-105 active:scale-[0.97]"
      >
        Continue to Invite
        <ArrowRight className="size-5" strokeWidth={2.6} />
      </button>
    </div>
  );
}
