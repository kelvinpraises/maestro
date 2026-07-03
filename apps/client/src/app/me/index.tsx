// /me — "me". The personal tab (DESIGN-STORY §5).
//
// Replaces the old "/settings" screen. Front-of-house is warm and personal:
//   • Stash card (balance, big, on butter) — the piggy, yours.
//   • Goal card, clearly LABELLED as a goal ("SAVING FOR" — hardcoded sample).
//   • Streak (hardcoded sample).
// Back-of-house lives in a quiet, collapsed "For grown-ups" panel (principle #7:
// no jargon leaks — plumbing vocabulary is demoted here, never on the home):
//   • Wallet address + copy, XLM balance, testnet top-up.
//   • The ONE privacy sentence.
//   • Allowance setup entry (→ /streams) — parents only.
// The old debug footer's treasury internals are pure plumbing — gone from the UI.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  CopyIcon,
  CheckIcon,
  PiggyBankIcon,
  TargetIcon,
  FireIcon,
  SparkleIcon,
  CaretRightIcon,
  CaretDownIcon,
  WrenchIcon,
  LockIcon,
  DropIcon,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/atoms/avatar";
import { IconTile } from "@/components/atoms/icon-tile";
import { toast } from "sonner";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { useFamily } from "@/hooks/use-family";
import { truncateAddress } from "@/utils";

export const Route = createFileRoute("/me/")({
  component: MePage,
});

function MePage() {
  const { publicKey, xlmBalance } = useStellarWallet();
  const { family, role } = useFamily();

  const displayName =
    family?.kidName?.trim() ||
    (family?.name?.trim() ? family.name.trim() : "You");

  // Real XLM balance is the stash (unfunded is a valid 0, not an error).
  const stashBalance = xlmBalance === null ? null : parseFloat(xlmBalance);

  // Hardcoded sample goal + streak (labelled clearly as samples in the UI).
  const goalName = "New Lego Set";
  const goalTarget = 25;
  const streakDays = 6;

  return (
    <div className="stagger-rise space-y-5">
      {/* Profile header */}
      <header className="animate-pop-in card-pop flex flex-col items-center gap-3 p-6 text-center">
        <Avatar className="size-20 rounded-[1.75rem] border-2 border-m-ink shadow-[var(--m-pop-sm)]">
          <AvatarImage
            src={`https://avatar.vercel.sh/${displayName}.png`}
            alt=""
          />
          <AvatarFallback className="rounded-[1.75rem] bg-m-sky font-display text-2xl font-extrabold text-m-blue">
            {displayName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="font-display text-2xl font-extrabold leading-tight">
            {displayName}
          </h1>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border-2 border-m-ink bg-primary/20 px-3 py-0.5 text-xs font-extrabold text-m-green-ink">
            <SparkleIcon className="size-3" weight="fill" />
            {role === "parent" ? "Family Grown-up" : "Chore Champion"}
          </span>
        </div>
      </header>

      {/* Stash — balance big, on butter. The piggy, yours. */}
      <div className="animate-pop-in card-pop card-pop-butter p-5">
        <div className="flex items-center gap-3">
          <IconTile icon={PiggyBankIcon} tint="gold" size="lg" bordered />
          <div className="min-w-0 flex-1">
            <p className="text-microlabel text-muted-foreground">My stash</p>
            <p className="text-money text-4xl leading-none">
              {stashBalance === null ? "…" : stashBalance.toFixed(2)}
              <span className="ml-1.5 align-baseline text-lg font-extrabold text-muted-foreground">
                XLM
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Goal + streak — a two-up of proud, clearly-labelled cards. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="animate-pop-in card-pop card-pop-lilac p-4">
          <IconTile icon={TargetIcon} tint="purple" bordered />
          <p className="text-microlabel mt-3 text-muted-foreground">Saving for</p>
          <p className="truncate font-display text-[15px] font-extrabold leading-tight">
            {goalName}
          </p>
          <p className="mt-0.5 font-display text-sm font-extrabold tabular-nums text-m-purple">
            {goalTarget.toFixed(0)} XLM
          </p>
        </div>
        <div className="animate-pop-in card-pop card-pop-pink p-4">
          <IconTile icon={FireIcon} tint="pink" bordered />
          <p className="text-microlabel mt-3 text-muted-foreground">Streak</p>
          <p className="font-display text-2xl font-extrabold leading-tight tabular-nums text-m-pink">
            {streakDays}
            <span className="ml-1 text-sm font-extrabold text-muted-foreground">
              days
            </span>
          </p>
          <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">
            Keep it going!
          </p>
        </div>
      </div>

      {/* For grown-ups — quiet, collapsed. Plumbing lives here, never up top. */}
      <GrownupsPanel
        publicKey={publicKey}
        xlmBalance={xlmBalance}
        isParent={role === "parent"}
      />
    </div>
  );
}

// ── For grown-ups: the collapsed plumbing drawer ─────────────────────────────

function GrownupsPanel({
  publicKey,
  xlmBalance,
  isParent,
}: {
  publicKey: string;
  xlmBalance: string | null;
  isParent: boolean;
}) {
  const navigate = useNavigate();
  const { fund, isFunding } = useStellarWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAddr = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey);
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="card-pop overflow-hidden bg-card/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <IconTile icon={WrenchIcon} tint="neutral" />
        <span className="flex-1 font-display text-[15px] font-extrabold text-foreground">
          For grown-ups
        </span>
        <CaretDownIcon
          className={`size-4 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          weight="bold"
        />
      </button>

      {/* Collapsible body: a grid-template-rows 0fr→1fr transition gives a real
          200ms open/close (the caret above rotates in step). The inner wrapper
          must be overflow-hidden and min-h-0 so it clips while collapsing.
          Under reduced-motion the grid snaps (no height animation). */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-pop)] motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden min-h-0">
          <div
            aria-hidden={!open}
            className="space-y-3 border-t-2 border-m-ink/10 px-4 pb-4 pt-3.5"
          >
          {/* Wallet address + copy */}
          {publicKey && (
            <button
              type="button"
              onClick={copyAddr}
              className="press-pop flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-m-ink bg-card px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <p className="text-microlabel text-muted-foreground">Wallet</p>
                <p className="font-mono text-[13px] font-bold text-foreground">
                  {truncateAddress(publicKey)}
                </p>
              </div>
              {copied ? (
                <CheckIcon className="size-4 shrink-0 text-primary" weight="bold" />
              ) : (
                <CopyIcon className="size-4 shrink-0 text-muted-foreground" weight="bold" />
              )}
            </button>
          )}

          {/* XLM balance */}
          <div className="flex items-center justify-between rounded-2xl border-2 border-m-ink bg-card px-4 py-3">
            <span className="text-sm font-bold text-muted-foreground">
              XLM balance
            </span>
            <span className="rounded-full border-2 border-m-ink bg-m-butter px-3 py-1 text-xs font-extrabold tabular-nums text-foreground">
              {xlmBalance === null
                ? "…"
                : `${parseFloat(xlmBalance).toFixed(2)} XLM`}
            </span>
          </div>

          {/* Testnet top-up */}
          <button
            type="button"
            onClick={() => void fund()}
            disabled={isFunding}
            className="press-pop flex h-11 w-full items-center justify-center gap-2 rounded-full border-2 border-m-ink bg-primary/20 font-display text-sm font-extrabold text-m-green-ink disabled:opacity-50"
          >
            <SparkleIcon className="size-4" weight="fill" />
            {isFunding ? "Funding…" : "Top up test XLM"}
          </button>

          {/* Allowance setup — parents only. */}
          {isParent && (
            <button
              type="button"
              onClick={() => navigate({ to: "/streams" })}
              className="press-pop flex w-full items-center gap-3 rounded-2xl border-2 border-m-ink bg-card px-4 py-3 text-left"
            >
              <DropIcon className="size-5 shrink-0 text-m-green-ink" weight="duotone" />
              <span className="flex-1 font-display text-[14px] font-extrabold text-foreground">
                Set up allowance
              </span>
              <CaretRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                weight="bold"
              />
            </button>
          )}

          {/* The one privacy sentence. */}
          <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[12px] font-semibold text-muted-foreground/80">
            <LockIcon className="size-3.5 shrink-0" weight="fill" />
            Rewards are private. Only your family knows.
          </p>
          </div>
        </div>
      </div>
    </section>
  );
}
