import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  ArrowLeftIcon,
  GiftIcon,
  SparkleIcon,
  WifiSlashIcon,
  MedalIcon,
} from "@phosphor-icons/react";
import { IconTile } from "@/components/atoms/icon-tile";
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
          className="press-pop flex size-11 items-center justify-center rounded-2xl border-2 border-m-ink bg-card text-foreground shadow-[var(--m-pop-sm)]"
        >
          <ArrowLeftIcon className="size-5" weight="bold" />
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
      <div className="animate-pop-in card-pop card-pop-green card-pop-lg flex items-center justify-between p-5 text-primary-foreground">
        <div>
          <p className="text-microlabel text-primary-foreground/70">
            Claimed so far
          </p>
          <p className="text-money text-4xl leading-none">
            {claimedTotal.toFixed(2)}
            <span className="ml-1.5 align-baseline text-lg font-extrabold text-primary-foreground/80">
              XLM
            </span>
          </p>
        </div>
        <span className="flex size-14 items-center justify-center rounded-[17px] border-2 border-m-ink bg-white/25 shadow-[var(--m-pop-sm)]">
          <MedalIcon className="size-8 text-m-gold" weight="fill" />
        </span>
      </div>

      {truncated && (
        <div className="flex items-center gap-2 card-pop card-pop-sm bg-card/70 px-4 py-3 text-xs font-semibold text-muted-foreground">
          <WifiSlashIcon className="size-4 shrink-0" weight="bold" />
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
        <div className="card-pop bg-card/70 p-8 text-center">
          <IconTile icon={GiftIcon} tint="lilac" size="lg" className="mx-auto" />
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
    <div className="flex items-center gap-3 card-pop p-3">
      <IconTile
        icon={claimed ? SparkleIcon : GiftIcon}
        tint={claimed ? "green" : "purple"}
        size="lg"
        bordered
      />
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
