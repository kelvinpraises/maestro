import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bell, Sparkles, Bed, Trash2, Utensils, Dog, PiggyBank, ChevronRight } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useMemo } from "react";
import { getPendingByType } from "@/utils/pending-engine";
import { formatUnits } from "viem";
import { WelcomeDialog } from "@/components/organisms/welcome-dialog";
import { EarningsHero } from "@/components/organisms/earnings-hero";
import { QuestCard, type QuestTint, type QuestStatus } from "@/components/molecules/quest-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/atoms/avatar";
import { useLocalStreams, cleanupCompletedStreams } from "@/store/stream-store";
import { useTokenBalance } from "@/hooks/use-stream-reads";
import { useStealthWallet } from "@/providers/stealth-wallet-provider";
import { useChain } from "@/providers/chain-provider";
import { getSendableTokens } from "@/config/chains";
import { useAutoCollect } from "@/hooks/use-auto-collect";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

// Sample quests for the kid home. Presentational only — the contract-wiring
// workstream will map these onto real chore/stream data.
type Quest = {
  id: string;
  title: string;
  amount: number;
  icon: typeof Bed;
  emoji: string;
  tint: QuestTint;
  status: QuestStatus;
};

const SAMPLE_QUESTS: Quest[] = [
  { id: "bed", title: "Make the Bed", amount: 2, icon: Bed, emoji: "🛏️", tint: "blue", status: "todo" },
  { id: "trash", title: "Take out Trash", amount: 1, icon: Trash2, emoji: "🗑️", tint: "purple", status: "todo" },
  { id: "dishes", title: "Wash Dishes", amount: 1.5, icon: Utensils, emoji: "🍽️", tint: "pink", status: "pending" },
  { id: "dog", title: "Walk the Dog", amount: 2.5, icon: Dog, emoji: "🐕", tint: "green", status: "todo" },
];

function DashboardPage() {
  const navigate = useNavigate();
  const { ready, authenticated } = usePrivy();

  // Redirect to pending circle join if one exists (post-login flow)
  useEffect(() => {
    if (!ready || !authenticated) return;
    const pending = getPendingByType("circle_join");
    if (pending.length === 0) return;
    const { inviteCode, senderPubKey } = pending[0].payload;
    if (inviteCode && senderPubKey) {
      navigate({ to: "/circles/join", search: { code: inviteCode, key: senderPubKey } });
    }
  }, [ready, authenticated, navigate]);

  // Stealth wallet (privacy layer) — kept intact for the wiring workstream
  const stealthWallet = useStealthWallet();
  const { stealthAddress, isReady: isStealthReady } = stealthWallet;

  const { chainConfig, chainId } = useChain();

  const tokens = getSendableTokens(chainConfig.contracts);
  const walletAddr = isStealthReady && stealthAddress ? (stealthAddress as `0x${string}`) : undefined;

  const { data: usdtBalanceRaw } = useTokenBalance(walletAddr, tokens[0]?.address);
  const { data: usdcBalanceRaw } = useTokenBalance(walletAddr, tokens[1]?.address);

  const usdcBalance = useMemo(() => {
    if (usdcBalanceRaw === undefined) return null;
    return parseFloat(formatUnits(usdcBalanceRaw, 18));
  }, [usdcBalanceRaw]);

  const usdtBalance = useMemo(() => {
    if (usdtBalanceRaw === undefined) return null;
    return parseFloat(formatUnits(usdtBalanceRaw, 18));
  }, [usdtBalanceRaw]);

  const totalBalance = (usdcBalance ?? 0) + (usdtBalance ?? 0);

  const { streams } = useLocalStreams();
  useEffect(() => {
    cleanupCompletedStreams(chainId);
  }, [chainId]);

  // Auto-collect incoming payments when enabled in settings
  useAutoCollect();

  // "Stash" savings-goal target (sample copy)
  const stashGoalTarget = 25;

  // Earned-this-week hero derives from delivered stream value when present,
  // else falls back to a friendly sample so the screen always reads well.
  const earnedThisWeek = useMemo(() => {
    if (streams.length === 0) return 12.5;
    const delivered = streams.reduce((sum, s) => sum + parseFloat(s.totalAmount || "0") * 0.25, 0);
    return Math.max(0, delivered);
  }, [streams]);

  const quests = SAMPLE_QUESTS;
  const questsLeft = quests.filter((q) => q.status !== "done").length;

  return (
    <div className="stagger-rise space-y-5">
      <WelcomeDialog />

      {/* Greeting header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="size-12 rounded-2xl border-2 border-card shadow-sm">
            <AvatarImage src={`https://avatar.vercel.sh/${stealthAddress || "alex"}.png`} alt="Alex" />
            <AvatarFallback className="rounded-2xl bg-m-sky font-display text-lg font-bold text-m-blue">
              A
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="font-display text-2xl font-extrabold leading-tight">
              Hey Alex! <span aria-hidden>👋</span>
            </h1>
            <p className="text-sm font-semibold text-muted-foreground">Ready to earn?</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: "/settings" })}
          aria-label="Notifications"
          className="flex size-11 items-center justify-center rounded-2xl border border-border/60 bg-card text-foreground shadow-sm transition-transform active:scale-95"
        >
          <Bell className="size-5" strokeWidth={2.4} />
        </button>
      </header>

      {/* Earnings hero */}
      <EarningsHero amount={earnedThisWeek} streakDays={6} />

      {/* My Stash mini-card → goals */}
      <button
        type="button"
        onClick={() => navigate({ to: "/yieldbox" })}
        className="animate-pop-in flex w-full items-center gap-3 rounded-3xl border border-border/60 bg-card p-4 text-left shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
      >
        <span className="flex size-11 items-center justify-center rounded-2xl bg-m-butter text-xl shadow-sm">
          <PiggyBank className="size-5 text-[oklch(0.55_0.12_78)]" strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            My Stash
          </p>
          <p className="font-display text-xl font-extrabold tabular-nums">
            ${totalBalance.toFixed(2)}
          </p>
        </div>
        <span className="mr-1 flex flex-col items-end">
          <span className="text-[11px] font-bold text-muted-foreground">
            Goal: New Lego Set
          </span>
          <span className="text-[11px] font-extrabold tabular-nums text-m-green-ink">
            ${stashGoalTarget.toFixed(2)}
          </span>
        </span>
        <ChevronRight className="size-5 text-muted-foreground" strokeWidth={2.6} />
      </button>

      {/* Today's Quests */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <Sparkles className="size-4 text-m-gold" strokeWidth={2.6} />
            Today&apos;s Quests
          </h2>
          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
            {questsLeft} Left
          </span>
        </div>

        <div className="space-y-2.5">
          {quests.map((q) => (
            <QuestCard
              key={q.id}
              title={q.title}
              amount={q.amount}
              icon={q.icon}
              emoji={q.emoji}
              tint={q.tint}
              status={q.status}
              onClick={() => navigate({ to: "/streams/$streamId", params: { streamId: q.id } })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
