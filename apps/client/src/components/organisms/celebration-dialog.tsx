import { useEffect } from "react";
import confetti from "canvas-confetti";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/molecules/dialog";
import { Button } from "@/components/atoms/button";

interface CelebrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kid's name for the copy, e.g. "Alex" */
  name?: string;
  /** Amount earned to show in the body */
  earnedThisWeek?: number;
  choresDone?: number;
  onKeepGoing?: () => void;
}

/**
 * The "It's working! 🎉" reward moment — trophy, a couple of proof points, and
 * a purple "Keep the Streak Going" CTA. Fires a confetti burst on open.
 */
export function CelebrationDialog({
  open,
  onOpenChange,
  name = "Alex",
  earnedThisWeek = 14.5,
  choresDone = 3,
  onKeepGoing,
}: CelebrationDialogProps) {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      confetti({
        particleCount: 90,
        spread: 75,
        origin: { y: 0.35 },
        colors: ["#5ecb6b", "#f4c542", "#8b5cf6", "#4aa3ff", "#ff8fa3"],
        scalar: 0.9,
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="text-center">
        <div className="mx-auto -mt-2 flex size-24 items-center justify-center rounded-full bg-m-butter shadow-inner">
          <span className="animate-coin-bounce text-5xl" aria-hidden>
            🏆
          </span>
        </div>

        <DialogTitle className="mt-2 text-center text-3xl">
          It&apos;s working! 🎉
        </DialogTitle>
        <DialogDescription className="text-center text-[15px] font-semibold text-muted-foreground">
          Don&apos;t break the momentum — the good habits are adding up.
        </DialogDescription>

        <div className="mt-1 space-y-2 text-left">
          <div className="flex items-center gap-2.5 rounded-2xl bg-primary/10 px-3.5 py-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-4" strokeWidth={3} />
            </span>
            <p className="text-sm font-bold text-foreground">
              {name} earned{" "}
              <span className="tabular-nums text-m-green-ink">
                ${earnedThisWeek.toFixed(2)}
              </span>{" "}
              this week
            </p>
          </div>
          <div className="flex items-center gap-2.5 rounded-2xl bg-primary/10 px-3.5 py-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-4" strokeWidth={3} />
            </span>
            <p className="text-sm font-bold text-foreground">
              {choresDone} chores done without asking
            </p>
          </div>
        </div>

        <Button
          size="lg"
          className="mt-2 w-full bg-m-purple text-white hover:brightness-105"
          onClick={() => {
            onKeepGoing?.();
            onOpenChange(false);
          }}
        >
          Keep the Streak Going
        </Button>
      </DialogContent>
    </Dialog>
  );
}
