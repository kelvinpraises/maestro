import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Sparkles, Plus, Minus, Coins, PiggyBank, Loader2, ArrowDownToLine } from "lucide-react";
import { cn } from "@/utils";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import {
  useAllowanceState,
  useCreateAllowance,
  useCollectAllowance,
} from "@/hooks/use-allowance";
import { AllowancePeriod, stroopsToXlm } from "@/lib/allowance";

export const Route = createFileRoute("/streams/")({
  component: AllowancePage,
});

const PERIODS: { id: AllowancePeriod; label: string }[] = [
  { id: "day", label: "per day" },
  { id: "week", label: "per week" },
];

function AllowancePage() {
  const { publicKey } = useStellarWallet();

  // ── create form state ──────────────────────────────────────────────────────
  const [rate, setRate] = useState(2);
  const [period, setPeriod] = useState<AllowancePeriod>("week");
  const [fundXlm, setFundXlm] = useState(10);

  const create = useCreateAllowance();
  const collect = useCollectAllowance();
  const state = useAllowanceState(publicKey);

  const adjust = (setter: (fn: (v: number) => number) => void, delta: number) =>
    setter((v) => Math.max(0, Math.round((v + delta) * 100) / 100));

  const waiting = useMemo(() => {
    if (!state.data) return null;
    // Everything the kid can still pull: whole cycles not yet received are
    // approximated by splittable + collectable that's already surfaced. We show
    // splittable + collectable (already-received-but-uncollected).
    return state.data.splittable + state.data.collectable;
  }, [state.data]);

  const fundedRemaining = state.data?.fundedRemaining ?? 0n;
  const hasReceivable =
    !!state.data &&
    (state.data.receivableCycles > 0n ||
      state.data.splittable > 0n ||
      state.data.collectable > 0n);

  return (
    <div className="stagger-rise space-y-5">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Allowance</h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          Set up a steady drip of XLM. It flows every few seconds — collect it
          whenever you like.
        </p>
      </header>

      {/* ── Live allowance state ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-sm">
          <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            <PiggyBank className="size-3.5" strokeWidth={2.6} />
            Still funded
          </span>
          <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">
            {state.isLoading ? "…" : `${stroopsToXlm(fundedRemaining).toFixed(4)}`}
          </p>
          <span className="text-[11px] font-bold text-muted-foreground">XLM</span>
        </div>
        <div className="rounded-3xl border border-border/60 bg-primary/10 p-4 shadow-sm">
          <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-m-green-ink">
            <Coins className="size-3.5" strokeWidth={2.6} />
            Waiting to collect
          </span>
          <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-m-green-ink">
            {state.isLoading || waiting === null ? "…" : `${stroopsToXlm(waiting).toFixed(4)}`}
          </p>
          <span className="text-[11px] font-bold text-m-green-ink/70">XLM</span>
        </div>
      </div>

      {/* ── Collect ───────────────────────────────────────────────────────── */}
      <button
        type="button"
        disabled={collect.isPending || !hasReceivable}
        onClick={() => collect.mutate({ to: publicKey })}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary font-display text-lg font-extrabold text-primary-foreground shadow-lg transition-[transform,filter] hover:brightness-[1.04] active:scale-[0.97] disabled:opacity-50"
      >
        {collect.isPending ? (
          <>
            <Loader2 className="size-5 animate-spin" strokeWidth={2.6} />
            Collecting…
          </>
        ) : (
          <>
            <ArrowDownToLine className="size-5" strokeWidth={2.6} />
            Collect my allowance
          </>
        )}
      </button>
      {collect.isSuccess && (
        <p className="text-center text-[13px] font-extrabold text-m-green-ink">
          Collected {stroopsToXlm(collect.data.collected).toFixed(4)} XLM! 🪙
        </p>
      )}
      {collect.isError && (
        <p className="text-center text-[13px] font-bold text-m-pink">
          {collect.error.message}
        </p>
      )}

      {/* ── Set up a new allowance ────────────────────────────────────────── */}
      <section className="space-y-3 rounded-[1.6rem] border border-border/60 bg-card p-4 shadow-sm">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <Sparkles className="size-4 text-m-gold" strokeWidth={2.6} />
          Start an allowance
        </h2>

        {/* Rate stepper */}
        <div className="flex items-center justify-between rounded-2xl bg-muted/60 px-3.5 py-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
              Rate
            </p>
            <p className="font-display text-lg font-extrabold tabular-nums text-m-green-ink">
              {rate.toFixed(2)} XLM
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Stepper label="Less" onClick={() => adjust(setRate, -0.5)} variant="muted" />
            <Stepper label="More" onClick={() => adjust(setRate, 0.5)} variant="primary" />
          </div>
        </div>

        {/* Period toggle */}
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={cn(
                "flex-1 rounded-2xl px-3 py-2.5 font-display text-sm font-extrabold transition-colors",
                period === p.id
                  ? "bg-m-purple text-white shadow-sm"
                  : "border-2 border-border bg-card text-muted-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Fund stepper */}
        <div className="flex items-center justify-between rounded-2xl bg-muted/60 px-3.5 py-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
              Fund with
            </p>
            <p className="font-display text-lg font-extrabold tabular-nums">
              {fundXlm.toFixed(2)} XLM
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Stepper label="Less" onClick={() => adjust(setFundXlm, -1)} variant="muted" />
            <Stepper label="More" onClick={() => adjust(setFundXlm, 1)} variant="primary" />
          </div>
        </div>

        <button
          type="button"
          disabled={create.isPending || fundXlm <= 0 || rate <= 0}
          onClick={() =>
            create.mutate({ rate, period, fundXlm, recipient: publicKey })
          }
          className="flex h-13 w-full items-center justify-center gap-2 rounded-full bg-m-blue py-3.5 font-display text-base font-extrabold text-white shadow-lg transition-[transform,filter] hover:brightness-105 active:scale-[0.97] disabled:opacity-50"
        >
          {create.isPending ? (
            <>
              <Loader2 className="size-5 animate-spin" strokeWidth={2.6} />
              Setting up…
            </>
          ) : (
            <>
              <Plus className="size-5" strokeWidth={2.8} />
              Start allowance
            </>
          )}
        </button>
        {create.isSuccess && (
          <p className="text-center text-[13px] font-extrabold text-m-green-ink">
            Allowance is live — money starts flowing in a few seconds! ✨
          </p>
        )}
        {create.isError && (
          <p className="text-center text-[13px] font-bold text-m-pink">
            {create.error.message}
          </p>
        )}
      </section>
    </div>
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
