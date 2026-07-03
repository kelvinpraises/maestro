// chore-card.tsx — the doing moment gets a room of its own (audit survivor 14 /
// doer's surface). Tapping a chore on the kid home opens THIS card, not a bare
// confirm sheet: the emoji big in its tile, the chore name, the note ("how to do
// it") when present, the reward chip, "Anyone can do this one" context for
// shared chores, and ONE huge primary "I did it! ✋".
//
// One component, two faces:
//   • todo    → shows the primary button (calls onConfirm).
//   • pending → shows the waiting state instead of the button (same card, so the
//     kid can reopen a chore they already waved in and see where it stands).
//
// Reduced-motion safe (the Dialog's zoom/fade is CSS-gated by data-state, which
// the reset respects) and exits faster than it enters (150ms out vs 200ms in,
// inherited from DialogContent). No new celebration lives here — per
// DESIGN-STORY §3.6 the one confetti stays on reward claims.

import { HandHeartIcon, ListChecksIcon } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/molecules/dialog";
import { Button } from "@/components/atoms/button";
import { EmojiTile, IconTile } from "@/components/atoms/icon-tile";

export interface ChoreCardChore {
  id: string;
  name: string;
  emoji?: string;
  rewardXlm: number;
  note?: string;
  /** Absent = "anyone" (shared, first-claim). Present = owned by that kid. */
  assignee?: string;
}

export function ChoreCard({
  chore,
  status,
  waitingFor,
  open,
  onOpenChange,
  onConfirm,
}: {
  chore: ChoreCardChore | null;
  /** The kid's own state for this chore. Only todo/pending open a card. */
  status: "todo" | "pending";
  /** Warmest generic for who's checking ("the grown-ups 👀"). */
  waitingFor: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const isAnyone = !!chore && !chore.assignee;
  const pending = status === "pending";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {/* Emoji big in its tile — the chore, front and center. */}
          <div className="mx-auto mb-1">
            {chore &&
              (chore.emoji ? (
                <EmojiTile emoji={chore.emoji} tint="green" size="lg" bordered />
              ) : (
                <IconTile icon={ListChecksIcon} tint="green" size="lg" bordered />
              ))}
          </div>
          <DialogTitle className="text-center">{chore?.name}</DialogTitle>
          <DialogDescription className="text-center">
            {pending
              ? `Waiting for ${waitingFor.replace(" 👀", "")} to check it off.`
              : `Finished it? We'll let ${waitingFor.replace(
                  " 👀",
                  "",
                )} know so they can send your reward.`}
          </DialogDescription>
        </DialogHeader>

        {/* Reward chip + anyone-chore context. */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border-2 border-m-ink bg-primary/20 px-3 py-1 font-display text-sm font-extrabold tabular-nums text-m-green-ink">
            +{chore ? chore.rewardXlm.toFixed(2) : "0.00"} XLM
          </span>
          {isAnyone && (
            <span className="inline-flex items-center gap-1 rounded-full border-2 border-m-ink bg-m-sky px-3 py-1 text-[13px] font-extrabold text-m-blue">
              <HandHeartIcon className="size-3.5" weight="fill" />
              Anyone can do this one
            </span>
          )}
        </div>

        {/* The note — "how to do it" — when the parent left one. */}
        {chore?.note && (
          <div className="rounded-2xl border-2 border-m-ink/15 bg-muted/40 px-3.5 py-2.5 text-center">
            <p className="text-microlabel text-muted-foreground">How to do it</p>
            <p className="mt-0.5 text-[13px] font-bold text-foreground text-pretty">
              {chore.note}
            </p>
          </div>
        )}

        {pending ? (
          // Pending face: no button — the waiting state, big and calm.
          <div className="rounded-2xl border-2 border-m-ink bg-m-sky/70 px-4 py-3 text-center">
            <p className="font-display text-[15px] font-extrabold text-m-blue">
              Waiting for {waitingFor}
            </p>
            <p className="mt-0.5 text-[12px] font-bold text-m-blue/70">
              Nice work — sit tight!
            </p>
          </div>
        ) : (
          <DialogFooter>
            {/* ONE huge primary. */}
            <Button size="lg" className="w-full text-lg" onClick={onConfirm}>
              I did it! ✋
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
