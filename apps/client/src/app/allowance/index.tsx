import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  SparkleIcon,
  PlusIcon,
  MinusIcon,
  CoinsIcon,
  PiggyBankIcon,
  SpinnerGapIcon,
  DownloadSimpleIcon,
  UserIcon,
  ClipboardIcon,
  DropIcon,
} from "@phosphor-icons/react";
import { cn } from "@/utils";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { ensureAccountFunded } from "@/lib/account";
import { useFamily } from "@/hooks/use-family";
import {
  getKidAddress,
  setKidAddress,
  randomId,
  KID_ADDRESSES_EVENT,
} from "@/lib/family";
import { requestPostNotice } from "@/hooks/use-family-board";
import {
  useAllowanceState,
  useCreateAllowance,
  useCollectAllowance,
} from "@/hooks/use-allowance";
import { AllowancePeriod, stroopsToXlm } from "@/lib/allowance";

// A first-class Allowance page. Owner ask: allowance shouldn't feel buried
// inside "streams" — it's a proper parent tool, reached from the Family Bank.
// The substance is the same steady-drip flow (recipient picker → rate → fund →
// live state → Scoop) that used to live on /streams, laid out as its own page.
// /streams now redirects here so every existing entry point keeps working.
export const Route = createFileRoute("/allowance/")({
  // Allowance is a parent tool (setting up a drip to a kid). A kid device that
  // lands here goes home — the kid's allowance surface is their stash card.
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem("maestro.family.v1");
      if (raw) {
        try {
          if (JSON.parse(raw).role === "kid") throw redirect({ to: "/dashboard" });
        } catch (e) {
          if (e && typeof e === "object" && "to" in e) throw e;
        }
      }
    }
  },
  component: AllowancePage,
});

const PERIODS: { id: AllowancePeriod; label: string }[] = [
  { id: "minute", label: "per minute" },
  { id: "hour", label: "per hour" },
  { id: "day", label: "per day" },
  { id: "week", label: "per week" },
];

/**
 * Who an allowance drips to. `kind: "myself"` streams to the parent's own
 * wallet (the single-wallet demo default); `kind: "kid"` resolves the named
 * kid's G-address from the local kid-addresses map; `kind: "address"` is a raw
 * pasted address. `resolvedAddress` is what actually gets wired to the mutation
 * (null when a kid has no known address yet — the paste field opens for them).
 */
type Recipient =
  | { kind: "myself" }
  | { kind: "kid"; name: string }
  | { kind: "address" };

function AllowancePage() {
  const { publicKey, keypair } = useStellarWallet();
  const { family } = useFamily();
  const kidNames = family?.kidNames ?? [];

  // Account bootstrap for a recipient that doesn't exist on-chain yet. A fresh
  // or pasted G-address has no base reserve, so a stream to it would fail with
  // op_no_destination. The parent (family bank) brings it into existence first.
  //   • idle    — nothing to do
  //   • setting — createAccount in flight ("Setting up their account…")
  //   • error   — bank couldn't fund it (honest, retriable)
  type SetupState = "idle" | "setting" | "error";
  const [setupState, setSetupState] = useState<SetupState>("idle");
  const [setupError, setSetupError] = useState<string | null>(null);

  // ── create form state ──────────────────────────────────────────────────────
  const [rate, setRate] = useState(2);
  const [period, setPeriod] = useState<AllowancePeriod>("week");
  const [fundXlm, setFundXlm] = useState(10);

  // ── recipient picker (item 5) ───────────────────────────────────────────────
  const [recipient, setRecipient] = useState<Recipient>({ kind: "myself" });
  const [pasteAddr, setPasteAddr] = useState("");
  // Bump to re-read the kid-addresses map after a save (same-tab event).
  const [addrTick, setAddrTick] = useState(0);
  useEffect(() => {
    const bump = () => setAddrTick((t) => t + 1);
    window.addEventListener(KID_ADDRESSES_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(KID_ADDRESSES_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  // The address a kid chip resolves to (null when we've never been told it).
  const knownKidAddress = useMemo(() => {
    void addrTick; // re-run after a save
    return recipient.kind === "kid" ? getKidAddress(recipient.name) : null;
  }, [recipient, addrTick]);

  // When the paste field is needed: a raw "Paste address" pick, or a kid chip
  // whose address we don't know yet.
  const needsPaste =
    recipient.kind === "address" ||
    (recipient.kind === "kid" && !knownKidAddress);

  // The concrete address wired to the create mutation, or null if unresolved.
  const resolvedAddress = useMemo<string | null>(() => {
    const pasted = pasteAddr.trim() || null;
    if (recipient.kind === "myself") return publicKey;
    if (recipient.kind === "kid") return knownKidAddress ?? pasted;
    return pasted; // "address"
  }, [recipient, knownKidAddress, pasteAddr, publicKey]);

  // A friendly label for the live-state card ("Dripping to Zuri").
  const recipientLabel =
    recipient.kind === "myself"
      ? "you"
      : recipient.kind === "kid"
        ? recipient.name
        : "a pasted address";

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
          A steady drip into your kid&apos;s stash, flowing every few seconds.
          Set the pace, fund it, and it pours in on its own.
        </p>
      </header>

      {/* Who it's dripping to (item 5). */}
      <div className="flex items-center gap-2 card-pop card-pop-sm bg-card/70 px-3.5 py-2.5">
        <DropIcon className="size-4 shrink-0 text-m-green-ink" weight="duotone" />
        <p className="min-w-0 flex-1 truncate text-[13px] font-extrabold text-foreground">
          Dripping to{" "}
          <span className="text-m-green-ink">{recipientLabel}</span>
        </p>
      </div>

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

        {/* Recipient picker: kid chips + Myself + Paste address (item 5). */}
        <div>
          <p className="text-microlabel mb-1.5 text-muted-foreground">Drips to</p>
          <div className="flex flex-wrap gap-2">
            {kidNames.map((k) => {
              const on = recipient.kind === "kid" && recipient.name === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setRecipient({ kind: "kid", name: k });
                    setPasteAddr("");
                  }}
                  className={cn(
                    "press-pop flex items-center gap-1.5 rounded-full border-2 border-m-ink px-3 py-2 font-display text-xs font-extrabold shadow-[var(--m-pop-sm)]",
                    on ? "bg-primary text-primary-foreground" : "bg-card text-foreground",
                  )}
                >
                  <span className="flex size-5 items-center justify-center rounded-full border-2 border-m-ink bg-m-sky text-[10px] font-extrabold text-m-blue">
                    {k.charAt(0).toUpperCase()}
                  </span>
                  {k}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setRecipient({ kind: "myself" });
                setPasteAddr("");
              }}
              className={cn(
                "press-pop flex items-center gap-1.5 rounded-full border-2 border-m-ink px-3 py-2 font-display text-xs font-extrabold shadow-[var(--m-pop-sm)]",
                recipient.kind === "myself"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground",
              )}
            >
              <UserIcon className="size-3.5" weight="bold" />
              Myself
            </button>
            <button
              type="button"
              onClick={() => {
                setRecipient({ kind: "address" });
                setPasteAddr("");
              }}
              className={cn(
                "press-pop flex items-center gap-1.5 rounded-full border-2 border-m-ink px-3 py-2 font-display text-xs font-extrabold shadow-[var(--m-pop-sm)]",
                recipient.kind === "address"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground",
              )}
            >
              <ClipboardIcon className="size-3.5" weight="bold" />
              Paste address
            </button>
          </div>

          {/* Paste field: opens for a raw address pick, or a kid with no known
              address (labelled for that kid; saved to the map on start). */}
          {needsPaste && (
            <input
              type="text"
              value={pasteAddr}
              onChange={(e) => setPasteAddr(e.target.value.trim())}
              placeholder={
                recipient.kind === "kid"
                  ? `Paste ${recipient.name}'s address (G…)`
                  : "Paste an address (G…)"
              }
              className="field-pop mt-2.5 w-full px-3.5 py-3 font-mono text-[13px] font-bold placeholder:font-display placeholder:font-bold placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-m-blue/50"
            />
          )}
        </div>

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

        {/* Period toggle — four paces (per minute is the fast, demo-friendly
            drip). Chips wrap so the row stays comfortable on a narrow phone. */}
        <div className="grid grid-cols-2 gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={cn(
                "press-pop rounded-2xl border-2 border-m-ink px-3 py-2.5 font-display text-sm font-extrabold",
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
          disabled={
            create.isPending ||
            setupState === "setting" ||
            fundXlm <= 0 ||
            rate <= 0 ||
            !resolvedAddress
          }
          onClick={() => {
            if (!resolvedAddress) return;
            const target = resolvedAddress;
            // Remember a freshly-pasted kid address for next time (item 5).
            if (recipient.kind === "kid" && !knownKidAddress) {
              setKidAddress(recipient.name, target);
            }
            // Bring the recipient's account into existence FIRST when it's not
            // the parent's own wallet. A fresh/pasted address has no base reserve,
            // so a stream to it would fail op_no_destination on collect. The
            // parent (family bank) funds a createAccount (1 XLM), then we open the
            // allowance. Myself → skip (the wallet already exists).
            const startAllowance = () =>
              create.mutate(
                { rate, period, fundXlm, recipient: target },
                {
                  onSuccess: () => {
                    // When the drip is aimed at a named kid, post an
                    // allowance-started notice so their phone shows "Your
                    // allowance is flowing". Myself/raw-address allowances post
                    // nothing (no kid to notify).
                    if (recipient.kind === "kid") {
                      requestPostNotice({
                        id: `allowance-${recipient.name}-${randomId()}`,
                        at: Date.now(),
                        kind: "allowance-started",
                        kidName: recipient.name,
                        rateXlm: rate,
                        period,
                      });
                    }
                  },
                },
              );

            // Own wallet already exists → straight to the allowance.
            if (recipient.kind === "myself" || target === publicKey) {
              startAllowance();
              return;
            }
            // Otherwise ensure the destination exists (createAccount + fund from
            // the parent bank) before opening the stream, so collect can't fail
            // op_no_destination. Idempotent — a known/existing account no-ops.
            setSetupState("setting");
            setSetupError(null);
            void ensureAccountFunded({ from: keypair, to: target }).then((res) => {
              if (res.kind === "exists" || res.kind === "created") {
                setSetupState("idle");
                startAllowance();
              } else {
                setSetupState("error");
                setSetupError(
                  res.transient
                    ? "Couldn't reach the network to set up this account. Try again in a moment."
                    : "This address isn't set up on Stellar yet and the family bank couldn't fund it. Top up the bank and try again.",
                );
              }
            });
          }}
          className="press-pop flex h-13 w-full items-center justify-center gap-2 rounded-full border-2 border-m-ink bg-m-blue py-3.5 font-display text-base font-extrabold text-white shadow-[var(--m-pop)] hover:brightness-105 disabled:opacity-50"
        >
          {create.isPending || setupState === "setting" ? (
            <>
              <SpinnerGapIcon className="size-5 animate-spin" weight="bold" />
              {setupState === "setting" ? "Setting up their account…" : "Setting up…"}
            </>
          ) : (
            <>
              <PlusIcon className="size-5" weight="bold" />
              Start allowance
            </>
          )}
        </button>
        {setupState === "error" && setupError && (
          <p className="text-center text-[13px] font-bold text-m-pink text-pretty">
            {setupError}
          </p>
        )}
        {/* A stream to a non-Maestro (pasted) address pays it, but that person
            still needs their own tooling to withdraw a drips stream (receive →
            split → collect). Surfaced honestly so nobody expects it to "just
            arrive" in a wallet that isn't running Maestro. */}
        {recipient.kind === "address" && !!resolvedAddress && (
          <p className="text-center text-[12px] font-semibold text-muted-foreground text-pretty">
            Heads up: a pasted address that isn&apos;t on Maestro still needs its
            own tools to collect a stream.
          </p>
        )}
        {create.isSuccess && (
          <p className="text-center text-[13px] font-extrabold text-m-green-ink">
            Allowance is live. Money starts flowing in a few seconds! ✨
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
