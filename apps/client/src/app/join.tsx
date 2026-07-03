// /join — a kid device opens the family invite link.
//
// The link fragment (#invite=<blob>) carries {familyId, familyName,
// parentAddress, kidName, chores}. Opening it stores the family membership on
// THIS device with role: kid (no accounts, no server). Chores ride along in the
// link so the kid's dashboard is populated immediately.
//
// This replaces the old server-backed circles/join flow — nothing here talks to
// any API server.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  ConfettiIcon,
  WarningCircleIcon,
  SparkleIcon,
  UsersThreeIcon,
  LockIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/atoms/button";
import { useFamily } from "@/hooks/use-family";
import {
  readHashParam,
  stripHash,
  decodeInvite,
  type InvitePayload,
} from "@/lib/family";

export const Route = createFileRoute("/join")({
  component: JoinFamilyPage,
});

function JoinFamilyPage() {
  const navigate = useNavigate();
  const { joinFamily } = useFamily();

  // Parse the invite blob during the FIRST render (useState initializer), before
  // any effect strips the hash. Under React StrictMode the mount effect runs
  // twice; reading the hash there would find it already gone on the second pass.
  const [{ invite, invalid }] = useState<{
    invite: InvitePayload | null;
    invalid: boolean;
  }>(() => {
    const blob = readHashParam("invite");
    if (!blob) return { invite: null, invalid: true };
    try {
      return { invite: decodeInvite(blob), invalid: false };
    } catch {
      return { invite: null, invalid: true };
    }
  });
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    // The invite isn't secret, but keep the URL tidy once we've parsed it.
    stripHash();
  }, []);

  const handleJoin = () => {
    if (!invite) return;
    joinFamily(invite);
    setJoined(true);
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
              Invite not valid
            </h1>
            <p className="mb-8 max-w-xs text-sm font-semibold text-muted-foreground text-pretty">
              This link is missing something or got cut off. Ask your grown-up to
              send it again.
            </p>
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/dashboard" })}
              className="w-full"
            >
              Go home
            </Button>
          </div>
        ) : !invite ? (
          <p className="text-sm font-bold text-muted-foreground">Opening…</p>
        ) : joined ? (
          <div className="flex flex-col items-center gap-6">
            <div className="flex size-24 items-center justify-center rounded-full border-2 border-m-ink bg-m-mint shadow-[var(--m-pop)]">
              <ConfettiIcon className="size-10 text-m-green-ink" weight="duotone" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-extrabold tracking-tight">
                You're in! 🎉
              </h1>
              <p className="mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
                Welcome to {invite.familyName}. Your chores are ready — go earn!
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => navigate({ to: "/dashboard" })}
              className="w-full"
            >
              See my chores
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-6 stagger-rise">
            {/* Big team tile — the hero of the "Join the Team!" moment */}
            <div className="animate-float-soft flex size-24 items-center justify-center rounded-[1.9rem] border-2 border-m-ink bg-m-mint shadow-[var(--m-pop-lg)]">
              <UsersThreeIcon className="size-12 text-m-green-ink" weight="duotone" />
            </div>

            <div>
              <p className="text-microlabel text-m-purple">You&apos;re invited</p>
              <h1 className="mt-1.5 font-display text-4xl font-extrabold leading-none tracking-tight">
                Join the Team! 🎈
              </h1>
              <p className="mx-auto mt-3 max-w-[16rem] text-[15px] font-bold text-muted-foreground text-pretty">
                {invite.kidName ? (
                  <>
                    Hey{" "}
                    <span className="text-foreground">{invite.kidName}</span> — you
                    made it!
                  </>
                ) : (
                  "You made it!"
                )}
              </p>
            </div>

            {/* Family name huge + the chore-count line ("Dad put 3 chores up") */}
            <div className="w-full max-w-xs card-pop card-pop-butter p-5 text-center">
              <p className="text-microlabel text-muted-foreground">Your family</p>
              <p className="mt-1 truncate font-display text-2xl font-extrabold leading-tight">
                {invite.familyName}
              </p>
              <div className="mt-3.5 inline-flex items-center gap-2 rounded-full border-2 border-m-ink bg-card px-4 py-1.5 shadow-[var(--m-pop-sm)]">
                <SparkleIcon className="size-4 text-m-gold" weight="fill" />
                <span className="font-display text-sm font-extrabold">
                  {invite.chores.length}{" "}
                  {invite.chores.length === 1 ? "chore" : "chores"} up for grabs
                </span>
              </div>

              {invite.chores.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {invite.chores.slice(0, 6).map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 rounded-full border-2 border-m-ink bg-card px-2.5 py-1 text-[12px] font-extrabold text-foreground shadow-[var(--m-pop-sm)]"
                    >
                      <span aria-hidden>{c.emoji}</span>
                      {c.name}
                    </span>
                  ))}
                  {invite.chores.length > 6 && (
                    <span className="inline-flex items-center rounded-full border-2 border-m-ink bg-card px-2.5 py-1 text-[12px] font-extrabold text-muted-foreground shadow-[var(--m-pop-sm)]">
                      +{invite.chores.length - 6} more
                    </span>
                  )}
                </div>
              )}
            </div>

            <Button size="lg" onClick={handleJoin} className="w-full max-w-xs">
              <SparkleIcon className="mr-2 size-5" weight="fill" />
              I&apos;m in!
            </Button>
            <button
              onClick={() => navigate({ to: "/dashboard" })}
              className="press-pop rounded-full border-2 border-m-ink bg-card px-6 py-2.5 text-sm font-extrabold text-muted-foreground shadow-[var(--m-pop-sm)] hover:text-foreground"
            >
              I'll do it later
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
