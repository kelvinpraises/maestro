// notices-bell.tsx — the bell returns, real this time (audit survivor 8).
//
// A bell in each home header that opens the notices inbox: this device's
// relevant board notices, newest-first, in an in-voice sheet. An unseen-count
// badge rides the bell (from a locally-stored last-seen timestamp); opening the
// sheet marks everything seen, and that sticks across reloads. Tapping a
// reward-ready notice lands the kid on /rewards, where the auto-imported reward
// is already waiting to claim.
//
// No new celebration lives here (DESIGN-STORY §3.6 — the one confetti stays on
// reward claims). The sheet reuses the Dialog primitive so it inherits the
// ease-out entrance and reduced-motion safety.

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  BellIcon,
  GiftIcon,
  UserPlusIcon,
  DropIcon,
  ChatCircleIcon,
  ListChecksIcon,
  HandWavingIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/molecules/dialog";
import { IconTile } from "@/components/atoms/icon-tile";
import { useNoticesInbox } from "@/hooks/use-family";
import { formatRelativeTime } from "@/utils";
import type { FamilyRole, FeedEntry } from "@/lib/family";

/** In-voice title + icon + tint for one inbox notice. */
function inboxRowCopy(e: FeedEntry): {
  title: string;
  sub?: string;
  icon: typeof GiftIcon;
  tint: "green" | "purple" | "gold" | "lilac";
  tappable: boolean;
} {
  switch (e.kind) {
    case "reward-ready":
      return {
        title: e.label ? `A reward for you: ${e.label} 🎁` : "A reward for you 🎁",
        sub:
          typeof e.amountXlm === "number"
            ? `${e.amountXlm.toFixed(2)} XLM · tap to claim`
            : "Tap to claim it privately",
        icon: GiftIcon,
        tint: "green",
        tappable: true,
      };
    case "allowance-started":
      return {
        title: "Your allowance is flowing 💧",
        sub:
          typeof e.rateXlm === "number" && e.period
            ? `${e.rateXlm.toFixed(2)} XLM a ${e.period}`
            : undefined,
        icon: DropIcon,
        tint: "gold",
        tappable: false,
      };
    case "chore-added":
      return {
        title: `New chore: ${e.emoji ? `${e.emoji} ` : ""}${e.text ?? "a chore"}`,
        sub: e.kidName ? `just for ${e.kidName}` : "anyone can grab it",
        icon: ListChecksIcon,
        tint: "purple",
        tappable: false,
      };
    case "chore-pending":
      return {
        title: `${e.kidName ?? "A kid"} says it's done ✋`,
        sub: e.text ? `${e.text} · needs your nod` : "needs your nod",
        icon: HandWavingIcon,
        tint: "gold",
        tappable: false,
      };
    case "kid-joined":
      return {
        title: `${e.kidName ?? "A kid"} joined the team 🎉`,
        icon: UserPlusIcon,
        tint: "purple",
        tappable: false,
      };
    case "message":
      return {
        title: e.text || "A note",
        sub: e.kidName ? `from ${e.kidName}` : undefined,
        icon: ChatCircleIcon,
        tint: "lilac",
        tappable: false,
      };
    default:
      return { title: e.text || "Activity", icon: ChatCircleIcon, tint: "lilac", tappable: false };
  }
}

/**
 * The bell button + its inbox sheet. Drops into a header. `role`/`kidName` scope
 * which notices are relevant (kid: rewards/allowance/messages for me; parent:
 * kids joining, messages).
 */
export function NoticesBell({
  role,
  kidName,
}: {
  role: FamilyRole | null;
  kidName?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { notices, unseenCount, markSeen } = useNoticesInbox(role, kidName);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) markSeen(); // opening the sheet clears the badge (and persists).
  };

  const tapNotice = (e: FeedEntry) => {
    const { tappable } = inboxRowCopy(e);
    if (!tappable) return;
    setOpen(false);
    if (e.kind === "reward-ready") navigate({ to: "/rewards" });
  };

  return (
    <>
      <button
        type="button"
        aria-label={
          unseenCount > 0 ? `Notices, ${unseenCount} new` : "Notices"
        }
        onClick={() => onOpenChange(true)}
        className="press-pop relative flex size-11 shrink-0 items-center justify-center rounded-2xl border-2 border-m-ink bg-card shadow-[var(--m-pop-sm)]"
      >
        <BellIcon className="size-5 text-foreground" weight="duotone" />
        {unseenCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full border-2 border-m-ink bg-m-pink px-1 font-display text-[11px] font-extrabold leading-none text-white shadow-[var(--m-pop-sm)]">
            {unseenCount > 9 ? "9+" : unseenCount}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notices</DialogTitle>
            <DialogDescription>
              {notices.length > 0
                ? "The latest from your family."
                : "Nothing new right now."}
            </DialogDescription>
          </DialogHeader>

          {notices.length === 0 ? (
            <div className="card-pop bg-card/70 p-6 text-center">
              <IconTile icon={BellIcon} tint="lilac" size="lg" className="mx-auto" />
              <p className="mt-2 font-display text-sm font-extrabold">
                All caught up
              </p>
              <p className="mt-0.5 text-[13px] font-bold text-muted-foreground text-pretty">
                Rewards, allowances, and notes from your family show up here.
              </p>
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-2.5 overflow-y-auto">
              {notices.map((e) => {
                const { title, sub, icon, tint, tappable } = inboxRowCopy(e);
                const body = (
                  <>
                    <IconTile icon={icon} tint={tint} size="lg" bordered />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[15px] font-bold text-foreground">
                        {title}
                      </p>
                      <p className="truncate text-xs font-semibold text-muted-foreground">
                        {sub ? `${sub} · ` : ""}
                        {formatRelativeTime(new Date(e.at))}
                      </p>
                    </div>
                    {tappable && (
                      <CaretRightIcon
                        className="size-5 shrink-0 text-muted-foreground"
                        weight="bold"
                      />
                    )}
                  </>
                );
                return tappable ? (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => tapNotice(e)}
                    className="press-pop card-pop flex w-full items-center gap-3 p-3 text-left"
                  >
                    {body}
                  </button>
                ) : (
                  <div key={e.id} className="card-pop flex items-center gap-3 p-3">
                    {body}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
