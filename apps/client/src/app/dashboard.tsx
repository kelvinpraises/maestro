import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  BellIcon,
  SparkleIcon,
  ListChecksIcon,
  PiggyBankIcon,
  CaretRightIcon,
  GiftIcon,
  UsersIcon,
  BroomIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { EarningsHero } from "@/components/organisms/earnings-hero";
import { QuestCard, type QuestTint } from "@/components/molecules/quest-card";
import { IconTile } from "@/components/atoms/icon-tile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/atoms/avatar";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { useMyRewards } from "@/hooks/use-rewards";
import { useFamily, useChoreStates } from "@/hooks/use-family";
import { zwerc20 } from "@/contracts/stellar";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

// Rotating pastel tints so a family's chores stay colorful without the parent
// picking a color per chore.
const QUEST_TINTS: QuestTint[] = ["blue", "purple", "pink", "green", "gold"];

function DashboardPage() {
  const navigate = useNavigate();

  // In-app Stellar wallet — the active family-treasury identity.
  const { publicKey, xlmBalance, balanceLoaded, fund, isFunding } =
    useStellarWallet();

  // Real XLM balance from testnet drives the "My Stash" card. Unfunded is a
  // valid 0 balance, not an error.
  const stashBalance = useMemo(() => {
    if (xlmBalance === null) return null;
    return parseFloat(xlmBalance);
  }, [xlmBalance]);

  // Proof of plumbing: read the treasury's `next_index()` through the zwerc20
  // bindings client (a real on-chain simulation). Should read 1 on a fresh tree.
  const [treeIndex, setTreeIndex] = useState<number | null>(null);
  const [treeError, setTreeError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tx = await zwerc20.next_index();
        if (!cancelled) setTreeIndex(Number(tx.result));
      } catch (err) {
        console.warn("[dashboard] zwerc20.next_index() read failed", err);
        if (!cancelled) setTreeError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // "Stash" savings-goal target (sample copy)
  const stashGoalTarget = 25;

  // Chores come from the family store (shared via the invite link). Per-device
  // kid progress (todo/pending/done) lives in chore-states. Parents get the same
  // list; the manage affordances live on the family screen.
  const { family, role } = useFamily();
  const { states, setChoreState } = useChoreStates();

  const quests = useMemo(
    () =>
      (family?.chores ?? []).map((c, i) => ({
        id: c.id,
        title: c.name,
        amount: c.rewardXlm,
        emoji: c.emoji,
        tint: QUEST_TINTS[i % QUEST_TINTS.length],
        status: states[c.id] ?? "todo",
      })),
    [family, states],
  );
  const questsLeft = quests.filter((q) => q.status !== "done").length;

  // Private rewards on this device (notes + on-chain claimed status).
  const rewards = useMyRewards();
  const rewardViews = rewards.data ?? [];
  const claimableCount = rewardViews.filter((r) => !r.claimed).length;

  // Earned this week (XLM): sum of this device's rewards that are claimed
  // on-chain AND were funded within the last 7 days. We approximate the claim
  // time with the note's funded time (the only local timestamp), which keeps
  // recently-earned rewards in-window. Empty → a graceful 0.
  const earnedThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return rewardViews
      .filter((r) => r.claimed && r.createdAt >= weekAgo)
      .reduce((sum, r) => sum + r.amountXlm, 0);
  }, [rewardViews]);

  return (
    <div className="stagger-rise space-y-5">
      {/* Greeting header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="size-12 rounded-2xl border-2 border-m-ink shadow-[var(--m-pop-sm)]">
            <AvatarImage src={`https://avatar.vercel.sh/${publicKey || "alex"}.png`} alt="Alex" />
            <AvatarFallback className="rounded-2xl bg-m-sky font-display text-lg font-bold text-m-blue">
              A
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="font-display text-2xl font-extrabold leading-tight">
              Hey Alex!
            </h1>
            <p className="text-sm font-semibold text-muted-foreground">Ready to earn?</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: "/settings" })}
          aria-label="Notifications"
          className="press-pop flex size-11 items-center justify-center rounded-2xl border-2 border-m-ink bg-card text-foreground shadow-[var(--m-pop-sm)]"
        >
          <BellIcon className="size-5" weight="bold" />
        </button>
      </header>

      {/* Earnings hero */}
      <EarningsHero amount={earnedThisWeek} streakDays={6} />

      {/* My Stash mini-card → treasury activity / earnings history */}
      <button
        type="button"
        onClick={() => navigate({ to: "/history" })}
        className="animate-pop-in press-pop card-pop card-pop-butter flex w-full items-center gap-3 p-4 text-left"
      >
        <IconTile icon={PiggyBankIcon} tint="gold" bordered />
        <div className="shrink-0">
          <p className="text-microlabel whitespace-nowrap text-muted-foreground">
            My Stash
          </p>
          <p className="text-money whitespace-nowrap text-xl">
            {stashBalance === null ? "…" : stashBalance.toFixed(2)}
            <span className="ml-1 text-[11px] font-bold text-muted-foreground">
              XLM
            </span>
          </p>
        </div>
        <span className="mr-1 flex min-w-0 flex-1 flex-col items-end">
          <span className="max-w-full truncate text-[11px] font-bold text-muted-foreground">
            Goal: New Lego Set
          </span>
          <span className="max-w-full truncate text-[11px] font-extrabold tabular-nums text-m-green-ink">
            {stashGoalTarget.toFixed(0)} XLM
          </span>
        </span>
        <CaretRightIcon className="size-5 shrink-0 text-muted-foreground" weight="bold" />
      </button>

      {/* Rewards mini-card → private-claim flow */}
      <button
        type="button"
        onClick={() => navigate({ to: "/rewards" })}
        className="animate-pop-in press-pop card-pop flex w-full items-center gap-3 p-4 text-left"
      >
        <IconTile icon={GiftIcon} tint="purple" bordered />
        <div className="min-w-0 flex-1">
          <p className="text-microlabel text-muted-foreground">
            Rewards
          </p>
          <p className="font-display text-xl font-extrabold">
            {claimableCount > 0
              ? `${claimableCount} ready to claim`
              : "Fund a private reward"}
          </p>
        </div>
        {claimableCount > 0 && (
          <span className="rounded-full border-2 border-m-ink bg-primary/20 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
            {claimableCount}
          </span>
        )}
        <CaretRightIcon className="size-5 text-muted-foreground" weight="bold" />
      </button>

      {/* Today's Quests — real chores from the family store */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <SparkleIcon className="size-4 text-m-gold" weight="fill" />
            Today&apos;s Quests
          </h2>
          {quests.length > 0 && (
            <span className="rounded-full border-2 border-m-ink bg-primary/20 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
              {questsLeft} Left
            </span>
          )}
        </div>

        {!family ? (
          <button
            type="button"
            onClick={() => navigate({ to: "/circles" })}
            className="animate-pop-in press-pop card-pop card-pop-lilac flex w-full items-center gap-3 p-5 text-left"
          >
            <IconTile icon={UsersIcon} tint="lilac" size="lg" bordered />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-extrabold">
                Set up your family
              </p>
              <p className="text-[13px] font-bold text-muted-foreground text-pretty">
                Add chores and invite your kids to start earning.
              </p>
            </div>
            <CaretRightIcon className="size-5 text-muted-foreground" weight="bold" />
          </button>
        ) : quests.length === 0 ? (
          <div className="card-pop bg-card/70 p-6 text-center">
            <IconTile icon={BroomIcon} tint="lilac" size="lg" className="mx-auto" />
            <p className="mt-2 font-display text-sm font-extrabold">
              No chores yet
            </p>
            <p className="mt-0.5 text-[13px] font-bold text-muted-foreground text-pretty">
              {role === "parent"
                ? "Add chores on your family screen."
                : "Your grown-up will add some soon!"}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {quests.map((q) => (
              <QuestCard
                key={q.id}
                title={q.title}
                amount={q.amount}
                icon={ListChecksIcon}
                emoji={q.emoji}
                tint={q.tint}
                status={q.status}
                onClick={() => {
                  if (role === "parent") {
                    // Parents manage chores + send rewards from the family screen.
                    navigate({ to: "/circles" });
                  } else {
                    // Kid taps a chore → mark it pending (grown-up then rewards it).
                    setChoreState(
                      q.id,
                      q.status === "pending" ? "todo" : "pending",
                    );
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Live-plumbing footer — proves the Stellar wallet + bindings are wired.
          Reads the family treasury's on-chain leaf index via the zwerc20 client
          and lets a demo user top up the in-app wallet from friendbot. */}
      <footer className="card-pop bg-card/70 p-4 text-[11px] font-semibold text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>Wallet</span>
          <span className="font-mono tabular-nums">
            {publicKey.slice(0, 4)}…{publicKey.slice(-4)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span>XLM balance</span>
          <span className="tabular-nums">
            {!balanceLoaded
              ? "loading…"
              : `${(stashBalance ?? 0).toFixed(2)} XLM`}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span>Treasury leaf index</span>
          <span className="tabular-nums">
            {treeError
              ? "unavailable"
              : treeIndex === null
                ? "reading…"
                : treeIndex}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void fund()}
          disabled={isFunding}
          className="press-pop mt-3 h-9 w-full rounded-full border-2 border-m-ink bg-primary/20 font-display text-xs font-extrabold text-m-green-ink disabled:opacity-50"
        >
          {isFunding ? "Funding…" : "Top up test XLM"}
        </button>
      </footer>
    </div>
  );
}
