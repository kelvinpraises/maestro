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
  PencilSimpleIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/atoms/avatar";
import { IconTile } from "@/components/atoms/icon-tile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/molecules/dialog";
import { Button } from "@/components/atoms/button";
import { Input } from "@/components/atoms/input";
import { toast } from "sonner";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { useFamily, useKidStreak, useSavingsGoal } from "@/hooks/use-family";
import { useTreasuryHistory } from "@/hooks/use-treasury-history";
import { GOAL_NAME_MAX, type SavingsGoal } from "@/lib/family";
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
  const myName = family?.kidName?.trim() || displayName;

  // Real XLM balance is the stash (unfunded is a valid 0, not an error).
  const stashBalance = xlmBalance === null ? null : parseFloat(xlmBalance);

  // Real goal (kid-set) + real streak (from the done log). No more Lego sample.
  const { goal, setSavingsGoal } = useSavingsGoal();
  const streakDays = useKidStreak(myName);

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

      {/* Goal + streak. The goal is real (kid-set); the streak renders only when
          it's live — a zero streak is a sad zero, so it hides entirely. When the
          streak hides, the goal card takes the full width. */}
      <div className={streakDays > 0 ? "grid grid-cols-2 gap-3" : ""}>
        <GoalCard
          balance={stashBalance}
          goal={goal}
          onSave={setSavingsGoal}
        />
        {streakDays > 0 && (
          <div className="animate-pop-in card-pop card-pop-pink p-4">
            <IconTile icon={FireIcon} tint="pink" bordered />
            <p className="text-microlabel mt-3 text-muted-foreground">Streak</p>
            <p className="font-display text-2xl font-extrabold leading-tight tabular-nums text-m-pink">
              {streakDays}
              <span className="ml-1 text-sm font-extrabold text-muted-foreground">
                {streakDays === 1 ? "day" : "days"}
              </span>
            </p>
            <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">
              Keep it going!
            </p>
          </div>
        )}
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

// ── Goal card — real, kid-set. Empty until named; a quiet pencil edits it. ────

function GoalCard({
  balance,
  goal,
  onSave,
}: {
  balance: number | null;
  goal: SavingsGoal | null;
  onSave: (goal: SavingsGoal | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  // No goal yet → the invite to set one ("What are you saving for?").
  if (!goal) {
    return (
      <>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="animate-pop-in press-pop card-pop card-pop-lilac flex w-full flex-col items-start p-4 text-left"
        >
          <IconTile icon={TargetIcon} tint="purple" bordered />
          <p className="text-microlabel mt-3 text-muted-foreground">Saving for</p>
          <p className="font-display text-[15px] font-extrabold leading-tight text-m-purple">
            What are you saving for?
          </p>
          <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">
            Tap to set a goal
          </p>
        </button>
        <GoalDialog
          open={editing}
          initial={null}
          onOpenChange={setEditing}
          onSave={onSave}
        />
      </>
    );
  }

  // Real progress: balance / target, capped at 100%.
  const pct =
    balance === null || goal.targetXlm <= 0
      ? 0
      : Math.min(100, Math.round((balance / goal.targetXlm) * 100));

  return (
    <>
      <div className="animate-pop-in card-pop card-pop-lilac relative p-4">
        <div className="flex items-start justify-between">
          <IconTile icon={TargetIcon} tint="purple" bordered />
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit goal"
            className="press-pop -mr-1 -mt-1 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/50 hover:text-foreground"
          >
            <PencilSimpleIcon className="size-4" weight="bold" />
          </button>
        </div>
        <p className="text-microlabel mt-3 text-muted-foreground">Saving for</p>
        <p className="truncate font-display text-[15px] font-extrabold leading-tight">
          {goal.name}
        </p>
        <p className="mt-0.5 font-display text-sm font-extrabold tabular-nums text-m-purple">
          {goal.targetXlm.toFixed(0)} XLM
        </p>
        {/* Real progress bar. */}
        <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full border-2 border-m-ink bg-white/60">
          <div
            className="h-full rounded-full bg-m-purple transition-[width] duration-500 ease-[var(--ease-out-pop)] motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] font-extrabold tabular-nums text-m-purple">
          {pct}%
        </p>
      </div>
      <GoalDialog
        open={editing}
        initial={goal}
        onOpenChange={setEditing}
        onSave={onSave}
      />
    </>
  );
}

/** The small set-a-goal dialog: name (≤24 chars) + target XLM stepper. */
function GoalDialog({
  open,
  initial,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initial: SavingsGoal | null;
  onOpenChange: (open: boolean) => void;
  onSave: (goal: SavingsGoal | null) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [target, setTarget] = useState<number>(initial?.targetXlm ?? 25);

  // Re-seed the fields each time the dialog opens (initial may have changed).
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setName(initial?.name ?? "");
    setTarget(initial?.targetXlm ?? 25);
    setWasOpen(true);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const trimmed = name.trim().slice(0, GOAL_NAME_MAX);
  const canSave = trimmed.length > 0 && target > 0;
  const step = (delta: number) =>
    setTarget((t) => Math.max(1, Math.min(9999, t + delta)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mx-auto mb-1">
            <IconTile icon={TargetIcon} tint="purple" size="lg" bordered />
          </div>
          <DialogTitle className="text-center">
            {initial ? "Update your goal" : "What are you saving for?"}
          </DialogTitle>
          <DialogDescription className="text-center">
            Pick a name and how much it costs. We&apos;ll show how close you are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="goal-name"
              className="text-microlabel mb-1.5 block px-1 text-muted-foreground"
            >
              Goal
            </label>
            <Input
              id="goal-name"
              value={name}
              maxLength={GOAL_NAME_MAX}
              placeholder="A new skateboard"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <span className="text-microlabel mb-1.5 block px-1 text-muted-foreground">
              Target
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => step(-5)}
                aria-label="Less"
                className="press-pop flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-m-ink bg-card text-foreground shadow-[var(--m-pop-sm)]"
              >
                <MinusIcon className="size-5" weight="bold" />
              </button>
              <div className="flex-1 rounded-2xl border-2 border-m-ink bg-white/70 py-2 text-center">
                <span className="font-display text-2xl font-extrabold tabular-nums">
                  {target}
                </span>
                <span className="ml-1 text-sm font-extrabold text-muted-foreground">
                  XLM
                </span>
              </div>
              <button
                type="button"
                onClick={() => step(5)}
                aria-label="More"
                className="press-pop flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-m-ink bg-card text-foreground shadow-[var(--m-pop-sm)]"
              >
                <PlusIcon className="size-5" weight="bold" />
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          {initial && (
            <Button
              variant="outline"
              onClick={() => {
                onSave(null);
                onOpenChange(false);
              }}
            >
              Clear
            </Button>
          )}
          <Button
            disabled={!canSave}
            onClick={() => {
              onSave({ name: trimmed, targetXlm: target });
              onOpenChange(false);
            }}
          >
            {initial ? "Save" : "Set goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

          {/* How claims stay private — the zk story, told honestly and calmly.
              The treasury pot is SHARED by every family on this deployment and
              claims are unattributable by design (that's the point). We never
              show the raw ledger here — a scrolling list of strangers' deposits
              reads as alarming, not reassuring. Just the benefit, plus a single
              non-identifying count (never a list, never an address or amount). */}
          <PrivacyExplainer />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── How claims stay private — the zk story, aggregate-only ────────────────────
//
// Replaces the old raw on-chain feed (which listed every family's deposits and
// claims). A family should never see strangers' transactions where they expect
// their own. So this is one calm line about why the ledger is unattributable,
// plus a single settled-count — a number, never a list of transactions.
//
// The count reuses useTreasuryHistory purely for its length; no per-tx row, no
// recipient address, no amount of any other family is ever rendered.

function PrivacyExplainer() {
  const { items } = useTreasuryHistory();
  const claims = items.filter((i) => i.kind === "claimed").length;

  return (
    <div className="rounded-2xl border-2 border-m-ink/15 bg-card/60 p-3.5">
      <p className="text-microlabel text-muted-foreground">How this stays private</p>
      <p className="mt-1 text-[12px] font-semibold leading-relaxed text-muted-foreground/90 text-pretty">
        Rewards are claimed privately. On the public ledger, no one can tell
        which claim belongs to which child, not even us.
      </p>
      {claims > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] font-bold text-muted-foreground">
          <LockIcon className="size-3.5 shrink-0 text-m-green-ink" weight="fill" />
          <span className="tabular-nums">{claims}</span>{" "}
          private {claims === 1 ? "reward" : "rewards"} settled on Maestro
        </p>
      )}
    </div>
  );
}
