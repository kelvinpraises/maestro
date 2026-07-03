// /claim-link — kid device opens a reward claim link from the parent.
//
// The link fragment (#claim=<blob>) carries one reward note's {secret,
// amountStroops, leafIndex, label}. We import it into use-rewards' localStorage
// (the SAME shape/key useMyRewards reads), then land the kid on /rewards where
// the existing "Claim privately" flow pays THEM.
//
// SECURITY (demo-grade): the note secret in the link IS the reward. We strip the
// hash from the URL immediately after import so the secret doesn't linger in the
// address bar or browser history. See src/lib/family.ts for the full note.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import {
  ConfettiIcon,
  GiftIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  LockIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/atoms/button";
import { deriveNote } from "@/lib/claims";
import { stroopsToXlm } from "@/lib/allowance";
import {
  readHashParam,
  stripHash,
  decodeClaimLinkPayload,
  noteFromClaimLink,
  importNote,
  type ClaimLinkPayload,
} from "@/lib/family";

// Emitted by use-rewards for same-tab note-list refreshes.
const NOTES_EVENT = "maestro:reward-notes-changed";

export const Route = createFileRoute("/claim-link")({
  component: ClaimLinkPage,
});

/** Derive a note's stable id exactly like use-rewards' fund path. */
function noteId(secret: bigint, amountStroops: bigint): string {
  const derived = deriveNote(secret, amountStroops);
  return "0x" + derived.nullifier.toString(16).padStart(64, "0");
}

function ClaimLinkPage() {
  const navigate = useNavigate();

  // Parse the claim blob during the FIRST render (useState initializer), before
  // any effect strips the hash. Under React StrictMode the mount effect runs
  // twice; reading the hash there would find it already gone on the second pass.
  const [{ payload, invalid }] = useState<{
    payload: ClaimLinkPayload | null;
    invalid: boolean;
  }>(() => {
    const blob = readHashParam("claim");
    if (!blob) return { payload: null, invalid: true };
    try {
      return { payload: decodeClaimLinkPayload(blob), invalid: false };
    } catch {
      return { payload: null, invalid: true };
    }
  });
  const [imported, setImported] = useState(false);

  useEffect(() => {
    // Strip the sensitive secret out of the URL right away (post-parse).
    stripHash();
  }, []);

  const amountXlm = useMemo(
    () => (payload ? stroopsToXlm(BigInt(payload.amountStroops)) : 0),
    [payload],
  );

  const handleAdd = () => {
    if (!payload) return;
    const note = noteFromClaimLink(payload, noteId);
    importNote(note);
    // Refresh useMyRewards listeners in this tab.
    window.dispatchEvent(new Event(NOTES_EVENT));
    setImported(true);
  };

  return (
    <div className="bg-maestro-canvas fixed inset-0 z-50 overflow-y-auto">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 py-10 text-center">
        {invalid ? (
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex size-20 items-center justify-center rounded-[1.75rem] border-2 border-m-ink bg-destructive/10 shadow-[var(--m-pop-sm)]">
              <WarningCircleIcon className="size-9 text-destructive" weight="duotone" />
            </div>
            <h1 className="mb-2 font-display text-2xl font-extrabold">
              Hmm, that link's not right
            </h1>
            <p className="mb-8 max-w-xs text-sm font-semibold text-muted-foreground text-pretty">
              This reward link is missing something or got cut off. Ask your
              grown-up to send it again.
            </p>
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/dashboard" })}
              className="w-full"
            >
              Go home
            </Button>
          </div>
        ) : !payload ? (
          <div className="flex flex-col items-center gap-3">
            <SpinnerGapIcon className="size-8 animate-spin text-primary" weight="bold" />
            <p className="text-sm font-bold text-muted-foreground">
              Opening your reward…
            </p>
          </div>
        ) : imported ? (
          <div className="flex flex-col items-center gap-6">
            <div className="flex size-24 items-center justify-center rounded-full border-2 border-m-ink bg-m-mint shadow-[var(--m-pop)]">
              <ConfettiIcon className="size-10 text-m-green-ink" weight="duotone" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-extrabold tracking-tight">
                In your stash! 🎉
              </h1>
              <p className="mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
                Your {amountXlm.toFixed(2)} XLM reward is ready for a private
                claim.
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => navigate({ to: "/rewards" })}
              className="w-full"
            >
              Claim it privately
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-7">
            <div className="mb-1">
              <h1 className="font-display text-4xl font-extrabold tracking-tight">
                A reward for you! 🎁
              </h1>
              <p className="mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
                {payload.label
                  ? `"${payload.label}" — nice work!`
                  : "Someone tucked a little something away for you."}
              </p>
            </div>

            {/* The reward, front and center */}
            <div className="flex w-full max-w-xs flex-col items-center gap-2 card-pop p-7">
              <span className="flex size-16 items-center justify-center rounded-[1.4rem] border-2 border-m-ink bg-m-purple/15 shadow-[var(--m-pop-sm)]">
                <GiftIcon className="size-8 text-m-purple" weight="duotone" />
              </span>
              <p className="text-money text-4xl text-m-green-ink">
                {amountXlm.toFixed(2)}
                <span className="ml-1 text-base font-bold text-muted-foreground">
                  XLM
                </span>
              </p>
              {payload.label && (
                <p className="font-display text-sm font-extrabold text-foreground">
                  {payload.label}
                </p>
              )}
            </div>

            <Button size="lg" onClick={handleAdd} className="w-full max-w-xs">
              <GiftIcon className="mr-2 size-5" weight="duotone" />
              Add to my stash
            </Button>
            <button
              onClick={() => navigate({ to: "/dashboard" })}
              className="press-pop rounded-full border-2 border-m-ink bg-card px-6 py-2.5 text-sm font-extrabold text-muted-foreground shadow-[var(--m-pop-sm)] hover:text-foreground"
            >
              Maybe later
            </button>
          </div>
        )}

        <p className="absolute bottom-6 flex items-center gap-1.5 text-xs font-bold text-muted-foreground/60">
          <LockIcon className="size-3.5" weight="fill" /> Private &amp; safe
        </p>
      </div>
    </div>
  );
}
