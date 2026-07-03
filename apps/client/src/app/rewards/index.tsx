import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import {
  GiftIcon,
  PlusIcon,
  MinusIcon,
  SparkleIcon,
  SpinnerGapIcon,
  ShieldCheckIcon,
  LockIcon,
} from "@phosphor-icons/react";
import { IconTile } from "@/components/atoms/icon-tile";
import { ConfettiBurst } from "@/components/atoms/confetti-burst";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { useCountUp } from "@/hooks/use-count-up";
import { useFamily } from "@/hooks/use-family";
import { cn } from "@/utils";
import {
  useFundReward,
  useMyRewards,
  useClaimReward,
  type ClaimStep,
  type RewardView,
} from "@/hooks/use-rewards";
import { classifyTxError } from "@/lib/tx-errors";

export const Route = createFileRoute("/rewards/")({
  component: RewardsPage,
});

// Kid-words staged copy for the private claim (Story B: "checking… sealing…
// yours!"), mapped to the claim mutation's real step state.
const CLAIM_STEP_LABEL: Record<ClaimStep, string> = {
  idle: "",
  rebuilding: "Checking…",
  proving: "Sealing…",
  submitting: "Almost yours…",
  done: "Yours!",
  error: "Something went wrong",
};

function RewardsPage() {
  const [amount, setAmount] = useState(1);
  const [label, setLabel] = useState("");

  // "Fund a reward" is a PARENT action (DESIGN-STORY §5: parent "send", kid
  // "claim"). The kid sees only the claimable side — never funding language.
  const { role } = useFamily();
  const isParent = role === "parent";

  const fund = useFundReward();
  const rewards = useMyRewards();

  // Inline fund notice, owned locally so it can be CLEARED — the mutation's own
  // isSuccess/isError flags stick until the next mutate() and would otherwise
  // sit on screen contradicting the current state (the reported stale bug).
  // Cleared: on a new fund action, after a ~5s auto-dismiss, and on unmount.
  const [notice, setNotice] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearNotice = () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
  };
  const showNotice = (n: { kind: "success" | "error"; text: string }) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(n);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };
  // Clear on unmount / navigation away.
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const adjust = (delta: number) =>
    setAmount((v) => Math.max(0.1, Math.round((v + delta) * 100) / 100));

  const rewardList = rewards.data ?? [];
  const claimable = rewardList.filter((r) => !r.claimed);
  const claimed = rewardList.filter((r) => r.claimed);

  // THE money moment lives at the page level, not inside a claim card — the card
  // unmounts the instant its note flips to "claimed", so the confetti + count-up
  // have to outlive it here. `celebrate` holds the just-landed amount; the
  // ConfettiBurst self-removes ~1.5s later.
  // The stash count-up shows the kid's whole pot (spending + private stash).
  const { totalBalance } = useStellarWallet();
  const stashBalance = totalBalance === null ? 0 : parseFloat(totalBalance);
  const displayBalance = useCountUp(stashBalance);
  const [celebrate, setCelebrate] = useState<number | null>(null);

  return (
    <div className="stagger-rise space-y-5">
      {/* THE one confetti — fires once when a reward's money lands in the stash. */}
      {celebrate !== null && (
        <ConfettiBurst onDone={() => setCelebrate(null)} />
      )}

      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Rewards</h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          {isParent
            ? "Tuck a reward into the family treasury. Your kid claims it privately, so nobody can tell who earned what."
            : "Rewards your family sent you. Claim each one privately, so nobody can tell what you earned."}
        </p>
      </header>

      {/* Into-your-stash banner: the money-landed count-up, page-level so it
          survives the claim card unmounting. */}
      {celebrate !== null && (
        <div className="animate-pop-in card-pop card-pop-mint flex items-center gap-3 p-4">
          <IconTile icon={SparkleIcon} tint="green" bordered />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] font-extrabold text-m-green-ink">
              Into your stash!
            </p>
            <p className="text-[13px] font-bold text-muted-foreground">
              +{celebrate.toFixed(2)} XLM
              <span className="mx-1 text-m-green-ink/40">·</span>
              <span className="tabular-nums text-m-green-ink">
                {displayBalance.toFixed(2)} XLM
              </span>
            </p>
          </div>
        </div>
      )}

      {/* ── Fund a reward (PARENT ONLY) ────────────────────────────────────── */}
      {isParent && (
      <section className="space-y-3 card-pop p-4">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <GiftIcon className="size-4 text-m-purple" weight="duotone" />
          Fund a reward
        </h2>

        {/* Amount stepper */}
        <div className="field-pop flex items-center justify-between px-3.5 py-3">
          <div>
            <p className="text-microlabel text-muted-foreground">
              Reward
            </p>
            <p className="text-money text-lg text-m-green-ink">
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
          className="field-pop w-full px-3.5 py-3 font-display text-sm font-bold placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-m-purple/50"
        />

        <button
          type="button"
          disabled={fund.isPending || amount <= 0}
          onClick={() => {
            clearNotice(); // starting a new action clears any prior notice
            fund.mutate(
              { amountXlm: amount, label: label.trim() || undefined },
              {
                onSuccess: () => {
                  setLabel("");
                  showNotice({
                    kind: "success",
                    text: "Reward hidden in the treasury, ready to claim! ✨",
                  });
                },
                onError: (e) =>
                  showNotice({
                    kind: "error",
                    text: classifyTxError(e, "fund").kidMessage,
                  }),
              },
            );
          }}
          className="press-pop flex h-13 w-full items-center justify-center gap-2 rounded-full border-2 border-m-ink bg-m-purple py-3.5 font-display text-base font-extrabold text-white shadow-[var(--m-pop)] hover:brightness-105 disabled:opacity-50"
        >
          {fund.isPending ? (
            <>
              <SpinnerGapIcon className="size-5 animate-spin" weight="bold" />
              Tucking it away…
            </>
          ) : (
            <>
              <PlusIcon className="size-5" weight="bold" />
              Fund reward
            </>
          )}
        </button>
        {notice?.kind === "success" && (
          <p className="animate-pop-in flex items-center justify-center gap-1.5 text-center text-[13px] font-extrabold text-m-green-ink">
            <LockIcon className="size-3.5" weight="bold" />
            {notice.text}
          </p>
        )}
        {notice?.kind === "error" && (
          <p className="animate-pop-in text-center text-[13px] font-bold text-m-pink">
            {notice.text}
          </p>
        )}
      </section>
      )}

      {/* ── Claimable rewards (kid) ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <SparkleIcon className="size-4 text-m-gold" weight="fill" />
            Claimable rewards
          </h2>
          {claimable.length > 0 && (
            <span className="rounded-full border-2 border-m-ink bg-primary/20 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
              {claimable.length} ready
            </span>
          )}
        </div>

        {rewards.isLoading && rewardList.length === 0 ? (
          <SkeletonCard />
        ) : claimable.length === 0 ? (
          <EmptyState isParent={isParent} />
        ) : (
          <div className="space-y-2.5">
            {claimable.map((r) => (
              <ClaimableCard
                key={r.id}
                reward={r}
                onClaimed={() => setCelebrate(r.amountXlm)}
              />
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
                className="flex items-center gap-3 card-pop bg-muted/40 p-3.5 opacity-70"
              >
                <IconTile icon={ShieldCheckIcon} tint="green" />

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

function ClaimableCard({
  reward,
  onClaimed,
}: {
  reward: RewardView;
  onClaimed: () => void;
}) {
  const claim = useClaimReward();
  const busy = claim.isPending;
  const stepLabel = CLAIM_STEP_LABEL[claim.step];
  const landed = claim.isSuccess;

  // Hand the money-landed moment up to the page: it owns THE confetti + the
  // stash count-up, so they outlive this card (which unmounts the instant its
  // note flips to "claimed"). Fire once, on the success edge.
  const firedRef = useRef(false);
  useEffect(() => {
    if (landed && !firedRef.current) {
      firedRef.current = true;
      onClaimed();
    }
  }, [landed, onClaimed]);

  return (
    <div className="animate-pop-in card-pop p-3.5">
      <div className="flex items-center gap-3">
        <IconTile icon={GiftIcon} tint="purple" bordered />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-extrabold">
            {reward.label || "Private reward"}
          </p>
          <p className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
            <ShieldCheckIcon className="size-3" weight="bold" />
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
        disabled={busy || landed}
        onClick={() => claim.mutate({ note: reward })}
        className="press-pop mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full border-2 border-m-ink bg-primary font-display text-sm font-extrabold text-primary-foreground shadow-[var(--m-pop)] hover:brightness-[1.03] disabled:opacity-60"
      >
        {landed ? (
          <>
            <SparkleIcon className="size-4" weight="fill" />
            Into your stash!
          </>
        ) : busy ? (
          <>
            <SpinnerGapIcon className="size-4 animate-spin" weight="bold" />
            {stepLabel}
          </>
        ) : (
          <>
            <LockIcon className="size-4" weight="bold" />
            Claim privately
          </>
        )}
      </button>

      {claim.isError && (
        <p className="mt-2 text-center text-[12px] font-bold text-m-pink text-pretty">
          {claim.errorMessage ??
            "The bank line is busy. Your reward is safe, try again in a moment."}
        </p>
      )}
    </div>
  );
}

function EmptyState({ isParent }: { isParent: boolean }) {
  return (
    <div className="card-pop bg-card/70 p-6 text-center">
      <IconTile icon={GiftIcon} tint="lilac" size="lg" className="mx-auto" />
      <p className="mt-2 font-display text-sm font-extrabold">
        {isParent ? "No rewards yet" : "Nothing to claim yet"}
      </p>
      <p className="mt-0.5 text-[13px] font-bold text-muted-foreground text-pretty">
        {isParent
          ? "Fund a reward above and it shows up here, ready for a private claim."
          : "When your family sends you a reward, it lands here to claim."}
      </p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="h-[92px] animate-pulse card-pop bg-muted/50" />
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
        "press-pop flex size-9 items-center justify-center rounded-full border-2 border-m-ink shadow-[var(--m-pop-sm)]",
        variant === "primary"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground",
      )}
    >
      {variant === "primary" ? (
        <PlusIcon className="size-4" weight="bold" />
      ) : (
        <MinusIcon className="size-4" weight="bold" />
      )}
    </button>
  );
}
