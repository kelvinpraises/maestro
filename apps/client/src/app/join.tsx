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
import { PartyPopper, AlertCircle, Sparkles } from "lucide-react";
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
            <div className="mb-4 flex size-20 items-center justify-center rounded-[1.75rem] bg-destructive/10 shadow-inner">
              <AlertCircle className="size-9 text-destructive" />
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
            <div className="flex size-24 items-center justify-center rounded-full bg-m-mint text-5xl shadow-inner">
              <PartyPopper className="size-10 text-m-green-ink" />
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
          <div className="flex flex-col items-center gap-7">
            <div className="mb-1">
              <h1 className="font-display text-4xl font-extrabold tracking-tight">
                Join the Team! 🎈
              </h1>
              <p className="mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
                <span className="text-foreground">{invite.familyName}</span>{" "}
                invited{" "}
                <span className="text-foreground">
                  {invite.kidName || "you"}
                </span>{" "}
                to start earning.
              </p>
            </div>

            {/* Family + chores preview */}
            <div className="flex w-full max-w-xs flex-col gap-3 rounded-[1.75rem] border border-border/60 bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-m-lilac text-2xl shadow-sm">
                  👨‍👩‍👧‍👦
                </span>
                <div className="min-w-0 text-left">
                  <p className="truncate font-display text-lg font-extrabold">
                    {invite.familyName}
                  </p>
                  <p className="text-[13px] font-bold text-muted-foreground">
                    {invite.chores.length}{" "}
                    {invite.chores.length === 1 ? "chore" : "chores"} to earn
                  </p>
                </div>
              </div>

              {invite.chores.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {invite.chores.slice(0, 6).map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[12px] font-extrabold text-foreground"
                    >
                      <span aria-hidden>{c.emoji}</span>
                      {c.name}
                    </span>
                  ))}
                  {invite.chores.length > 6 && (
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[12px] font-extrabold text-muted-foreground">
                      +{invite.chores.length - 6} more
                    </span>
                  )}
                </div>
              )}
            </div>

            <Button size="lg" onClick={handleJoin} className="w-full max-w-xs">
              <Sparkles className="mr-2 size-5" strokeWidth={2.6} />
              Join {invite.familyName}
            </Button>
            <button
              onClick={() => navigate({ to: "/dashboard" })}
              className="rounded-full border-2 border-border bg-card px-6 py-2.5 text-sm font-extrabold text-muted-foreground shadow-sm transition-transform hover:text-foreground active:scale-95"
            >
              I'll do it later
            </button>
          </div>
        )}

        <p className="absolute bottom-6 flex items-center gap-1 text-xs font-bold text-muted-foreground/60">
          🔒 Private &amp; safe
        </p>
      </div>
    </div>
  );
}
