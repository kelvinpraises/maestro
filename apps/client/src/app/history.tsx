import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowLeft, Gift, Sparkles, WifiOff } from "lucide-react";
import { useTreasuryHistory, type HistoryItem } from "@/hooks/use-treasury-history";
import { formatRelativeTime, truncateAddress } from "@/utils";

export const Route = createFileRoute("/history")({
  component: TreasuryHistoryPage,
});

/**
 * Family-treasury activity feed: private rewards funded and claimed, newest
 * first. On-chain events (Soroban RPC, retention-bounded) fused with this
 * device's own reward notes so the user's activity is always present.
 */
function TreasuryHistoryPage() {
  const navigate = useNavigate();
  const { items, truncated, isLoading } = useTreasuryHistory();

  // Total XLM claimed across the visible feed — the "paid out so far" headline.
  const claimedTotal = useMemo(
    () =>
      items
        .filter((i) => i.kind === "claimed")
        .reduce((sum, i) => sum + i.amountXlm, 0),
    [items],
  );

  return (
    <div className="stagger-rise space-y-5">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/dashboard" })}
          aria-label="Back"
          className="flex size-11 items-center justify-center rounded-2xl border border-border/60 bg-card text-foreground shadow-sm transition-transform active:scale-95"
        >
          <ArrowLeft className="size-5" strokeWidth={2.4} />
        </button>
        <div>
          <h1 className="font-display text-2xl font-extrabold leading-tight">
            Family Treasury
          </h1>
          <p className="text-sm font-semibold text-muted-foreground">
            Rewards funded &amp; claimed
          </p>
        </div>
      </header>

      {/* Paid-out total */}
      <div className="animate-pop-in flex items-center justify-between rounded-3xl bg-primary p-5 text-primary-foreground shadow-lg">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-primary-foreground/70">
            Claimed so far
          </p>
          <p className="font-display text-4xl font-extrabold leading-none tabular-nums">
            {claimedTotal.toFixed(2)}
            <span className="ml-1.5 align-baseline text-lg font-extrabold text-primary-foreground/80">
              XLM
            </span>
          </p>
        </div>
        <span className="text-4xl" aria-hidden>
          🏅
        </span>
      </div>

      {truncated && (
        <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-xs font-semibold text-muted-foreground">
          <WifiOff className="size-4 shrink-0" strokeWidth={2.4} />
          <span>
            Showing recent activity plus your own rewards. Older on-chain history
            may be beyond the network&apos;s retention window.
          </span>
        </div>
      )}

      {/* Activity list */}
      {isLoading && items.length === 0 ? (
        <p className="px-1 text-sm font-semibold text-muted-foreground">
          Loading treasury activity…
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/70 bg-card/60 p-8 text-center">
          <span className="text-3xl" aria-hidden>
            🎁
          </span>
          <p className="mt-2 font-display text-base font-bold text-foreground">
            No rewards yet
          </p>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            Fund a private reward to start your family treasury.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: HistoryItem }) {
  const claimed = item.kind === "claimed";
  return (
    <div className="flex items-center gap-3 rounded-[1.6rem] border border-border/60 bg-card p-3 shadow-sm">
      <span
        className={`flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ${
          claimed ? "bg-primary/15 text-m-green-ink" : "bg-m-purple/12 text-m-purple"
        }`}
      >
        {claimed ? (
          <Sparkles className="size-5" strokeWidth={2.4} />
        ) : (
          <Gift className="size-5" strokeWidth={2.4} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[15px] font-bold text-foreground">
          {claimed ? "Reward claimed" : "Reward funded"}
          {item.mine && (
            <span className="ml-1.5 align-middle text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
              · you
            </span>
          )}
        </p>
        <p className="truncate text-xs font-semibold text-muted-foreground">
          {formatRelativeTime(new Date(item.timestamp))}
          {claimed && item.to ? ` · to ${truncateAddress(item.to)}` : ""}
        </p>
      </div>
      <span
        className={`shrink-0 font-display text-base font-extrabold tabular-nums ${
          claimed ? "text-m-green-ink" : "text-foreground"
        }`}
      >
        {claimed ? "+" : ""}
        {item.amountXlm.toFixed(2)}
        <span className="ml-0.5 text-[11px] font-bold text-muted-foreground">XLM</span>
      </span>
    </div>
  );
}
