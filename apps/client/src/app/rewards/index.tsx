import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Gift,
  Plus,
  Minus,
  Sparkles,
  Loader2,
  ShieldCheck,
  PartyPopper,
  Lock,
} from "lucide-react";
import { cn } from "@/utils";
import {
  useFundReward,
  useMyRewards,
  useClaimReward,
  type ClaimStep,
  type RewardView,
} from "@/hooks/use-rewards";

export const Route = createFileRoute("/rewards/")({
  component: RewardsPage,
});

const CLAIM_STEP_LABEL: Record<ClaimStep, string> = {
  idle: "",
  rebuilding: "Reading the treasury…",
  proving: "Making your secret proof…",
  submitting: "Claiming your XLM…",
  done: "Claimed!",
  error: "Something went wrong",
};

function RewardsPage() {
  const [amount, setAmount] = useState(1);
  const [label, setLabel] = useState("");

  const fund = useFundReward();
  const rewards = useMyRewards();

  const adjust = (delta: number) =>
    setAmount((v) => Math.max(0.1, Math.round((v + delta) * 100) / 100));

  const rewardList = rewards.data ?? [];
  const claimable = rewardList.filter((r) => !r.claimed);
  const claimed = rewardList.filter((r) => r.claimed);

  return (
    <div className="stagger-rise space-y-5">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Rewards</h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          Parents tuck a reward into the family treasury. Kids claim it
          privately — nobody can tell who earned what.
        </p>
      </header>

      {/* ── Fund a reward (parent) ─────────────────────────────────────────── */}
      <section className="space-y-3 rounded-[1.6rem] border border-border/60 bg-card p-4 shadow-sm">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <Gift className="size-4 text-m-purple" strokeWidth={2.6} />
          Fund a reward
        </h2>

        {/* Amount stepper */}
        <div className="flex items-center justify-between rounded-2xl bg-muted/60 px-3.5 py-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
              Reward
            </p>
            <p className="font-display text-lg font-extrabold tabular-nums text-m-green-ink">
              {amount.toFixed(2)} XLM
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Stepper label="Less" onClick={() => adjust(-0.5)} variant="muted" />
            <Stepper label="More" onClick={() => adjust(0.5)} variant="primary" />
          </div>
        </div>

        {/* Optional label */}
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 40))}
          placeholder="What's it for? (e.g. Cleaned room)"
          className="w-full rounded-2xl border-2 border-border bg-card px-3.5 py-3 font-display text-sm font-bold placeholder:text-muted-foreground/70 focus:border-m-purple focus:outline-none"
        />

        <button
          type="button"
          disabled={fund.isPending || amount <= 0}
          onClick={() =>
            fund.mutate(
              { amountXlm: amount, label: label.trim() || undefined },
              { onSuccess: () => setLabel("") },
            )
          }
          className="flex h-13 w-full items-center justify-center gap-2 rounded-full bg-m-purple py-3.5 font-display text-base font-extrabold text-white shadow-lg transition-[transform,filter] hover:brightness-105 active:scale-[0.97] disabled:opacity-50"
        >
          {fund.isPending ? (
            <>
              <Loader2 className="size-5 animate-spin" strokeWidth={2.6} />
              Tucking it away…
            </>
          ) : (
            <>
              <Plus className="size-5" strokeWidth={2.8} />
              Fund reward
            </>
          )}
        </button>
        {fund.isSuccess && (
          <p className="flex items-center justify-center gap-1.5 text-center text-[13px] font-extrabold text-m-green-ink">
            <Lock className="size-3.5" strokeWidth={2.8} />
            Reward hidden in the treasury — ready to claim! ✨
          </p>
        )}
        {fund.isError && (
          <p className="text-center text-[13px] font-bold text-m-pink">
            {fund.error.message}
          </p>
        )}
      </section>

      {/* ── Claimable rewards (kid) ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <Sparkles className="size-4 text-m-gold" strokeWidth={2.6} />
            Claimable rewards
          </h2>
          {claimable.length > 0 && (
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
              {claimable.length} ready
            </span>
          )}
        </div>

        {rewards.isLoading && rewardList.length === 0 ? (
          <SkeletonCard />
        ) : claimable.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2.5">
            {claimable.map((r) => (
              <ClaimableCard key={r.id} reward={r} />
            ))}
          </div>
        )}
      </section>

      {/* ── Claimed (history) ──────────────────────────────────────────────── */}
      {claimed.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 font-display text-sm font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            Already claimed
          </h2>
          <div className="space-y-2.5">
            {claimed.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-3xl border border-border/60 bg-muted/40 p-3.5 opacity-70"
              >
                <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/15 text-lg">
                  ✅
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-extrabold">
                    {r.label || "Private reward"}
                  </p>
                  <p className="text-[11px] font-bold text-muted-foreground">
                    Claimed
                  </p>
                </div>
                <span className="font-display text-sm font-extrabold tabular-nums text-muted-foreground">
                  {r.amountXlm.toFixed(2)} XLM
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── one claimable reward, with its own claim state machine ────────────────────

function ClaimableCard({ reward }: { reward: RewardView }) {
  const claim = useClaimReward();
  const busy = claim.isPending;
  const stepLabel = CLAIM_STEP_LABEL[claim.step];

  return (
    <div className="animate-pop-in rounded-3xl border border-border/60 bg-card p-3.5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-m-purple/12 text-xl shadow-sm">
          🎁
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-extrabold">
            {reward.label || "Private reward"}
          </p>
          <p className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
            <ShieldCheck className="size-3" strokeWidth={2.8} />
            Private claim
          </p>
        </div>
        <span className="font-display text-lg font-extrabold tabular-nums text-m-green-ink">
          {reward.amountXlm.toFixed(2)}
          <span className="ml-0.5 text-[11px] font-bold text-muted-foreground">
            XLM
          </span>
        </span>
      </div>

      <button
        type="button"
        disabled={busy || claim.isSuccess}
        onClick={() => claim.mutate({ note: reward })}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary font-display text-sm font-extrabold text-primary-foreground shadow-md transition-[transform,filter] hover:brightness-[1.04] active:scale-[0.97] disabled:opacity-60"
      >
        {claim.isSuccess ? (
          <>
            <PartyPopper className="size-4" strokeWidth={2.8} />
            Claimed {reward.amountXlm.toFixed(2)} XLM!
          </>
        ) : busy ? (
          <>
            <Loader2 className="size-4 animate-spin" strokeWidth={2.8} />
            {stepLabel}
          </>
        ) : (
          <>
            <Lock className="size-4" strokeWidth={2.8} />
            Claim privately
          </>
        )}
      </button>
      {claim.isError && (
        <p className="mt-2 text-center text-[12px] font-bold text-m-pink">
          {claim.error.message}
        </p>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-dashed border-border/70 bg-card/60 p-6 text-center">
      <span className="text-3xl" aria-hidden>
        🎈
      </span>
      <p className="mt-2 font-display text-sm font-extrabold">No rewards yet</p>
      <p className="mt-0.5 text-[13px] font-bold text-muted-foreground text-pretty">
        Fund a reward above and it shows up here, ready for a private claim.
      </p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="h-[92px] animate-pulse rounded-3xl border border-border/60 bg-muted/50" />
  );
}

function Stepper({
  label,
  onClick,
  variant,
}: {
  label: string;
  onClick: () => void;
  variant: "muted" | "primary";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-9 items-center justify-center rounded-full shadow-sm transition-transform active:scale-90",
        variant === "primary"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground",
      )}
    >
      {variant === "primary" ? (
        <Plus className="size-4" strokeWidth={3} />
      ) : (
        <Minus className="size-4" strokeWidth={3} />
      )}
    </button>
  );
}
