// /welcome — the front door (first open, no family on this device).
//
// A family arrives one of two ways: a grown-up BUILDS it, or a kid is INVITED
// into it. So the first screen offers exactly two doors — no login, no signup.
// The in-app Stellar wallet is already being created silently by the provider;
// nothing here asks for a password.
//
// Route guard: this screen is for devices with NO family. If a family is already
// stored, we bounce home (the door's already been walked through).

import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
  PiggyBankIcon,
  HeartHalfIcon,
  LinkSimpleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/atoms/button";
import { loadFamily } from "@/lib/family";

export const Route = createFileRoute("/welcome")({
  // If this device already has a family, the front door is behind us.
  beforeLoad: () => {
    if (typeof window !== "undefined" && loadFamily()) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: WelcomePage,
});

function WelcomePage() {
  const navigate = useNavigate();
  // "doors" = the two-door choice; "invite" = the friendly kid explainer.
  const [view, setView] = useState<"doors" | "invite">("doors");

  return (
    <div className="bg-maestro-canvas fixed inset-0 z-50 overflow-y-auto">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 py-10 text-center">
        {view === "doors" ? (
          <div className="flex w-full flex-col items-center gap-7 stagger-rise">
            {/* Maestro identity — the piggy is the mascot, in a butter tile. */}
            <div className="flex flex-col items-center gap-5">
              <div className="animate-float-soft flex size-28 items-center justify-center rounded-[2rem] border-2 border-m-ink bg-m-butter shadow-[var(--m-pop-lg)]">
                <PiggyBankIcon
                  className="size-16 text-[oklch(0.55_0.14_78)]"
                  weight="duotone"
                />
              </div>
              <div>
                <h1 className="font-display text-[2.6rem] font-extrabold leading-none tracking-tight">
                  Maestro
                </h1>
                <p className="mx-auto mt-3 max-w-[17rem] text-[15px] font-bold text-muted-foreground text-pretty">
                  Chores your kids actually want to do, with a real stash they
                  keep.
                </p>
              </div>
            </div>

            {/* The two doors */}
            <div className="mt-1 flex w-full max-w-xs flex-col gap-3">
              <Button
                size="lg"
                onClick={() => navigate({ to: "/setup" })}
                className="w-full justify-between text-[15px]"
              >
                <span className="flex items-center gap-2.5">
                  <HeartHalfIcon className="size-5" weight="fill" />
                  I&apos;m the grown-up
                </span>
                <ArrowRightIcon className="size-5" weight="bold" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setView("invite")}
                className="w-full justify-between text-[15px]"
              >
                <span className="flex items-center gap-2.5">
                  <LinkSimpleIcon className="size-5 text-m-purple" weight="bold" />
                  I got an invite
                </span>
                <ArrowRightIcon className="size-5" weight="bold" />
              </Button>
            </div>

            <p className="max-w-[16rem] text-xs font-bold text-muted-foreground/70 text-pretty">
              No passwords. Your family bank is made for you in a tap.
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-7 stagger-rise">
            <div className="flex size-24 items-center justify-center rounded-[1.9rem] border-2 border-m-ink bg-m-lilac shadow-[var(--m-pop)]">
              <LinkSimpleIcon className="size-11 text-m-purple" weight="duotone" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-extrabold tracking-tight">
                Got a family link?
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
                Ask your grown-up to send you the family link. It opens right
                here and pops you straight onto the team.
              </p>
            </div>

            <div className="w-full max-w-xs card-pop card-pop-sky p-4 text-left">
              <p className="text-microlabel text-m-blue">How it works</p>
              <ol className="mt-2 space-y-1.5 text-[13.5px] font-bold text-foreground/80">
                <li>1. Your grown-up taps &quot;Invite&quot; on their phone.</li>
                <li>2. They send you the link (texts, chats, anywhere).</li>
                <li>3. You tap it. Balloons, and you&apos;re on the team!</li>
              </ol>
            </div>

            <button
              onClick={() => setView("doors")}
              className="press-pop flex items-center gap-2 rounded-full border-2 border-m-ink bg-card px-6 py-2.5 text-sm font-extrabold text-muted-foreground shadow-[var(--m-pop-sm)] hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" weight="bold" />
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
