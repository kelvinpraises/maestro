import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  SparkleIcon,
  PlusIcon,
  MinusIcon,
  CoinsIcon,
  PiggyBankIcon,
  SpinnerGapIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
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
    // Everything the kid can still pull right now: already-received-but-
    // uncollected (splittable + collectable) plus the streamed-out amount a
    // fresh receive would credit (receivableStreamed). The last term is what
    // moves before any scoop — without it this reads a flat 0 while streaming.
    return (
      state.data.splittable +
      state.data.collectable +
      state.data.receivableStreamed
    );
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
          A steady drip into your kid&apos;s stash — it flows every few seconds.
          Set the pace, fund it, and it pours in on its own.
        </p>
      </header>

      {/* ── Live allowance state ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="card-pop card-pop-butter p-4">
          <span className="flex items-center gap-1.5 text-microlabel text-muted-foreground">
            <PiggyBankIcon className="size-3.5" weight="duotone" />
            Still funded
          </span>
          <p className="mt-1 text-money text-2xl">
            {state.isLoading ? "…" : `${stroopsToXlm(fundedRemaining).toFixed(4)}`}
          </p>
          <span className="text-[11px] font-bold text-muted-foreground">XLM</span>
        </div>
        <div className="card-pop card-pop-mint p-4">
          <span className="flex items-center gap-1.5 text-microlabel text-m-green-ink">
            <CoinsIcon className="size-3.5" weight="duotone" />
            Waiting to collect
          </span>
          <p className="mt-1 text-money text-2xl text-m-green-ink">
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
        className="press-pop flex h-14 w-full items-center justify-center gap-2 rounded-full border-2 border-m-ink bg-primary font-display text-lg font-extrabold text-primary-foreground shadow-[var(--m-pop)] hover:brightness-[1.03] disabled:opacity-50"
      >
        {collect.isPending ? (
          <>
            <SpinnerGapIcon className="size-5 animate-spin" weight="bold" />
            Scooping…
          </>
        ) : (
          <>
            <DownloadSimpleIcon className="size-5" weight="bold" />
            Scoop it up
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
      <section className="space-y-3 card-pop p-4">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <SparkleIcon className="size-4 text-m-gold" weight="fill" />
          Start an allowance
        </h2>

        {/* Rate stepper */}
        <div className="field-pop flex items-center justify-between px-3.5 py-3">
          <div>
            <p className="text-microlabel text-muted-foreground">
              Rate
            </p>
            <p className="text-money text-lg text-m-green-ink">
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
                "press-pop flex-1 rounded-2xl border-2 border-m-ink px-3 py-2.5 font-display text-sm font-extrabold",
                period === p.id
                  ? "bg-m-purple text-white shadow-[var(--m-pop-sm)]"
                  : "bg-card text-muted-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Fund stepper */}
        <div className="field-pop flex items-center justify-between px-3.5 py-3">
          <div>
            <p className="text-microlabel text-muted-foreground">
              Fund with
            </p>
            <p className="text-money text-lg">
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
          className="press-pop flex h-13 w-full items-center justify-center gap-2 rounded-full border-2 border-m-ink bg-m-blue py-3.5 font-display text-base font-extrabold text-white shadow-[var(--m-pop)] hover:brightness-105 disabled:opacity-50"
        >
          {create.isPending ? (
            <>
              <SpinnerGapIcon className="size-5 animate-spin" weight="bold" />
              Setting up…
            </>
          ) : (
            <>
              <PlusIcon className="size-5" weight="bold" />
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
