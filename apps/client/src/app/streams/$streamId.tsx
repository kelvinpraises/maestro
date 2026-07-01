import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Camera, Sparkles, Send, RotateCcw } from "lucide-react";
import { CelebrationDialog } from "@/components/organisms/celebration-dialog";

export const Route = createFileRoute("/streams/$streamId")({
  component: ChoreDetailPage,
});

// Sample chore metadata keyed by quest id (presentational). The contract-wiring
// workstream will replace this with real chore/stream lookups.
const CHORES: Record<string, { title: string; reward: number; emoji: string; hint: string }> = {
  bed: { title: "Make the Bed", reward: 2, emoji: "🛏️", hint: "Make sure the whole bed is in the picture and the lighting is good!" },
  trash: { title: "Take out Trash", reward: 1, emoji: "🗑️", hint: "Show the empty bin and a fresh bag inside." },
  dishes: { title: "Wash Dishes", reward: 1.5, emoji: "🍽️", hint: "Snap the clean, sparkling dishes in the rack." },
  dog: { title: "Walk the Dog", reward: 2.5, emoji: "🐕", hint: "A happy pup and a full water bowl does the trick!" },
};

const DEFAULT_CHORE = { title: "Finish the Chore", reward: 2, emoji: "⭐", hint: "Snap a clear photo so it's easy to approve." };

type Phase = "capture" | "review" | "submitted";

function ChoreDetailPage() {
  const { streamId } = Route.useParams();
  const navigate = useNavigate();
  const chore = CHORES[streamId] ?? DEFAULT_CHORE;

  const [phase, setPhase] = useState<Phase>("capture");
  const [celebrate, setCelebrate] = useState(false);

  return (
    <div className="stagger-rise space-y-5">
      {/* Top bar */}
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate({ to: "/dashboard" })}
          aria-label="Back"
          className="flex size-11 items-center justify-center rounded-2xl border border-border/60 bg-card text-foreground shadow-sm transition-transform active:scale-95"
        >
          <ArrowLeft className="size-5" strokeWidth={2.4} />
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 font-display text-sm font-extrabold text-primary-foreground shadow-sm">
          <Sparkles className="size-4" strokeWidth={2.8} />
          +${chore.reward.toFixed(2)} Reward
        </span>
        <span className="size-11" aria-hidden />
      </header>

      {/* Title */}
      <div className="text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">{chore.title}</h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          {phase === "review"
            ? "Looking good? Send it to a grown-up!"
            : phase === "submitted"
              ? "Nice work — waiting for approval."
              : "Show us your masterpiece! Take a photo."}
        </p>
      </div>

      {/* Viewfinder */}
      <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-[2rem] bg-[oklch(0.28_0.03_285)] shadow-lg">
        {/* faux camera scene */}
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_35%,oklch(0.4_0.04_285),oklch(0.24_0.03_285))]">
          <span className="text-7xl opacity-90" aria-hidden>
            {chore.emoji}
          </span>
        </div>

        {/* framing corners */}
        {phase === "capture" && (
          <>
            <Corner className="left-4 top-4 border-l-4 border-t-4" />
            <Corner className="right-4 top-4 border-r-4 border-t-4" />
            <Corner className="bottom-4 left-4 border-b-4 border-l-4" />
            <Corner className="bottom-4 right-4 border-b-4 border-r-4" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-1 font-display text-xs font-extrabold text-foreground shadow-md">
              Aim here!
            </span>
          </>
        )}

        {phase !== "capture" && (
          <span className="absolute right-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[11px] font-extrabold text-primary-foreground shadow-sm">
            ${chore.reward.toFixed(2)}
          </span>
        )}
      </div>

      {/* Hint */}
      {phase === "capture" && (
        <div className="mx-auto flex max-w-xs items-start gap-2 rounded-2xl bg-m-sky px-3.5 py-2.5">
          <span className="text-base" aria-hidden>💡</span>
          <p className="text-[13px] font-bold text-foreground text-pretty">{chore.hint}</p>
        </div>
      )}

      {/* Actions */}
      <div className="mx-auto w-full max-w-xs space-y-2.5">
        {phase === "capture" && (
          <button
            type="button"
            onClick={() => setPhase("review")}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-m-blue font-display text-lg font-extrabold text-white shadow-lg transition-[transform,filter] hover:brightness-105 active:scale-[0.97]"
          >
            <Camera className="size-5" strokeWidth={2.6} />
            SNAP PHOTO!
          </button>
        )}

        {phase === "review" && (
          <>
            <button
              type="button"
              onClick={() => {
                setPhase("submitted");
                setCelebrate(true);
              }}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary font-display text-lg font-extrabold text-primary-foreground shadow-lg transition-[transform,filter] hover:brightness-[1.04] active:scale-[0.97]"
            >
              <Send className="size-5" strokeWidth={2.6} />
              Send to Mom
            </button>
            <button
              type="button"
              onClick={() => setPhase("capture")}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-border bg-card font-display text-base font-extrabold text-foreground shadow-sm transition-transform active:scale-[0.97]"
            >
              <RotateCcw className="size-4" strokeWidth={2.6} />
              Retake
            </button>
          </>
        )}

        {phase === "submitted" && (
          <div className="rounded-3xl border border-border/60 bg-card p-4 text-center shadow-sm">
            <p className="font-display text-base font-extrabold text-m-green-ink tabular-nums">
              + ${chore.reward.toFixed(2)} incoming… 🪙
            </p>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">
              We'll ping you when it's approved.
            </p>
            <button
              type="button"
              onClick={() => navigate({ to: "/dashboard" })}
              className="mt-3 text-sm font-extrabold text-primary underline-offset-4 hover:underline"
            >
              Back to quests
            </button>
          </div>
        )}
      </div>

      <CelebrationDialog
        open={celebrate}
        onOpenChange={setCelebrate}
        earnedThisWeek={14.5}
        choresDone={3}
        onKeepGoing={() => navigate({ to: "/dashboard" })}
      />
    </div>
  );
}

function Corner({ className }: { className?: string }) {
  return (
    <span
      className={`pointer-events-none absolute size-8 rounded-[6px] border-white/90 ${className ?? ""}`}
    />
  );
}
