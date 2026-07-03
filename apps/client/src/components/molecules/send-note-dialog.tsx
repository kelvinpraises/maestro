// send-note-dialog.tsx — "Send a note" (task #4, requirement 6).
//
// A minimal 90-character message affordance. The parent sends to their kids
// (from the family Kids group); a kid sends to the family (from the team card).
// The note posts a signed `message` notice on the board (so it reaches other
// devices' feed + bell) AND records a local feed note, so it shows on the
// sender's own device immediately without waiting for a board round-trip.
//
// The sender's display name rides in `kidName`; the bell hides a message from
// whoever authored it (loadInboxNotices filters `kidName !== me`), so a kid
// doesn't get pinged by their own note. No new celebration lives here
// (DESIGN-STORY §3.6 — the one confetti stays on reward claims).

import { useState } from "react";
import { PaperPlaneRightIcon, PlusIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/molecules/dialog";
import { Button } from "@/components/atoms/button";
import { recordLocalNote, randomId } from "@/lib/family";
import { requestPostNotice } from "@/hooks/use-family-board";

const MAX_LEN = 90;

/**
 * The send-a-note trigger button + its dialog. `senderName` is stamped on the
 * note so the reader sees who it's from and the sender's own bell stays quiet.
 * `recipientHint` colours the copy ("to Zuri" / "to your family").
 *
 * `iconOnly` renders a small round "+" (the affordance beside the Family activity
 * header); otherwise a labelled pill. `triggerClassName` overrides either.
 */
export function SendNoteDialog({
  senderName,
  recipientHint,
  triggerClassName,
  triggerLabel = "Send a note",
  iconOnly = false,
}: {
  senderName: string;
  recipientHint: string;
  triggerClassName?: string;
  triggerLabel?: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const remaining = MAX_LEN - text.length;

  const reset = () => {
    setText("");
    setOpen(false);
  };

  const send = () => {
    if (!trimmed) return;
    const id = `msg-${randomId()}`;
    const at = Date.now();
    // Post to the board so it reaches the other device's feed + bell…
    requestPostNotice({
      id,
      at,
      kind: "message",
      kidName: senderName,
      text: trimmed,
    });
    // …and record it locally (same id) so the sender's own feed shows it now.
    // loadFamilyFeed dedupes by id, so the board copy won't double it later.
    recordLocalNote({ id, at, kind: "message", kidName: senderName, text: trimmed });
    reset();
    toast.success("Note sent");
  };

  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          aria-label={`Send a note ${recipientHint}`}
          onClick={() => setOpen(true)}
          className={
            triggerClassName ??
            "press-pop flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-m-ink bg-card shadow-[var(--m-pop-sm)]"
          }
        >
          <PlusIcon className="size-4 text-foreground" weight="bold" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            triggerClassName ??
            "press-pop flex items-center justify-center gap-1.5 rounded-full border-2 border-m-ink bg-card px-3 py-2 text-xs font-extrabold text-foreground shadow-[var(--m-pop-sm)]"
          }
        >
          <PaperPlaneRightIcon className="size-3.5" weight="bold" />
          {triggerLabel}
        </button>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a note</DialogTitle>
            <DialogDescription>
              A quick message {recipientHint}. It shows up in your family feed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <textarea
              autoFocus
              value={text}
              maxLength={MAX_LEN}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              placeholder="Say something nice…"
              rows={3}
              className="w-full resize-none rounded-2xl border-2 border-m-ink bg-card px-3.5 py-3 font-display text-[15px] font-bold text-foreground shadow-[var(--m-pop-sm)] outline-none placeholder:text-muted-foreground/70 focus:border-m-ink"
            />
            <p className="px-1 text-right text-xs font-bold tabular-nums text-muted-foreground">
              {remaining}
            </p>
          </div>

          <Button className="w-full" disabled={!trimmed} onClick={send}>
            <PaperPlaneRightIcon className="mr-1.5 size-4" weight="bold" />
            Send
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
