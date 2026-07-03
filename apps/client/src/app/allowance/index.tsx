import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  CheckCircleIcon,
  HeartIcon,
} from "@phosphor-icons/react";
import { cn } from "@/utils";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { ensureAccountFunded } from "@/lib/account";
import { useFamily, useFamilyFeed } from "@/hooks/use-family";
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
  type CollectStep,
} from "@/hooks/use-allowance";
import { useAllowanceDrip } from "@/hooks/use-allowance-drip";
import { AllowancePeriod, stroopsToXlm } from "@/lib/allowance";

// A first-class Allowance page, now ROLE-AWARE (owner ask):
//   • PARENT sees the setup/manage tool — reached from the Family Bank. A parent
//     can send ONE allowance to SEVERAL kids at once (multi-select, DEFAULTS to
//     the kids, never "myself"); each kid gets the chosen rate and the pot covers
//     the sum. "Myself" (single-device demo) and "Paste address" stay secondary.
//   • KID sees their OWN allowance — who's sending it and the rate, the live drip
//     ticker + "Waiting to collect", and a "Scoop it up" that collects into THEIR
//     stash (the same useAllowanceDrip + useCollectAllowance the stash card uses).
//     No parent setup controls. A friendly empty state when there's no allowance.
//
// /streams redirects here so every existing entry point keeps working. Kids reach
// this from their stash card's drip line on the dashboard (no URL typing).
export const Route = createFileRoute("/allowance/")({
  component: AllowancePage,
});

/** Dispatch by role: a kid sees their own allowance, a parent sees the setup tool. */
function AllowancePage() {
  const { family } = useFamily();
  if (family?.role === "kid") return <KidAllowanceView />;
  return <ParentAllowanceView />;
}

const PERIODS: { id: AllowancePeriod; label: string }[] = [
  { id: "minute", label: "per minute" },
  { id: "hour", label: "per hour" },
  { id: "day", label: "per day" },
  { id: "week", label: "per week" },
];

// Below this a waiting amount is dust: not worth a gas-costing scoop. We hide the
// Scoop button below it (only scoop when there's really something to scoop), and
// once a stream's funding is also drained to dust we mark it Done instead of
// leaving it in the live section forever. 0.0001 XLM = 1000 stroops.
const DUST_STROOPS = 1_000n;
const DUST_XLM = 0.0001;

/**
 * Which recipient mode the picker is in.
 *   • "kids"    — the DEFAULT: stream to one or more of the family's kids (each
 *                 kid resolves to their published spending address). Multi-select.
 *   • "myself"  — the single-device demo: stream to the parent's own wallet, which
 *                 also plays the kid role on that one device (so the parent CAN
 *                 scoop here). Secondary.
 *   • "address" — a raw pasted G-address. Secondary.
 */
type RecipientMode = "kids" | "myself" | "address";

function ParentAllowanceView() {
  const { publicKey, keypair } = useStellarWallet();
  const { family } = useFamily();
  const kidNames = useMemo(() => family?.kidNames ?? [], [family?.kidNames]);

  // Account bootstrap for a recipient that doesn't exist on-chain yet. A fresh
  // or pasted G-address has no base reserve, so a stream to it would fail with
  // op_no_destination on collect. The parent (family bank) brings each recipient
  // into existence first.
  //   • idle    — nothing to do
  //   • setting — createAccount(s) in flight ("Setting up their account…")
  //   • error   — bank couldn't fund one (honest, retriable)
  type SetupState = "idle" | "setting" | "error";
  const [setupState, setSetupState] = useState<SetupState>("idle");
  const [setupError, setSetupError] = useState<string | null>(null);

  // ── create form state ──────────────────────────────────────────────────────
  const [rate, setRate] = useState(2);
  const [period, setPeriod] = useState<AllowancePeriod>("week");
  const [fundXlm, setFundXlm] = useState(10);

  // ── recipient picker ─────────────────────────────────────────────────────────
  // Default to the kids (all of them), NOT "myself". A family with no kids yet
  // falls back to the single-device "myself" path.
  const [mode, setMode] = useState<RecipientMode>(
    kidNames.length > 0 ? "kids" : "myself",
  );
  const [selectedKids, setSelectedKids] = useState<Set<string>>(
    () => new Set(kidNames),
  );
  // Per-kid pasted address (for a kid whose address we don't know yet), keyed by
  // kid name. Separate from the single "address" mode paste below.
  const [kidPaste, setKidPaste] = useState<Record<string, string>>({});
  const [pasteAddr, setPasteAddr] = useState(""); // for "address" mode

  // Bump to re-read the kid-addresses map after a save/board sync (same-tab).
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

  // Once kids arrive (board sync populated kidNames), seed the default selection
  // and flip out of the no-kids "myself" fallback the first time.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && kidNames.length > 0) {
      setSelectedKids(new Set(kidNames));
      setMode("kids");
      setSeeded(true);
    }
  }, [kidNames, seeded]);

  const toggleKid = (name: string) => {
    setMode("kids");
    setSelectedKids((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // The known on-chain address for each selected kid (null when never told it).
  // Recomputed after a save/sync via addrTick.
  const kidResolutions = useMemo(() => {
    void addrTick; // re-run after a save/sync
    return kidNames.map((name) => {
      const known = getKidAddress(name);
      const pasted = kidPaste[name]?.trim() || null;
      return {
        name,
        selected: selectedKids.has(name),
        known,
        // The concrete address we'd stream to (known wins; else a fresh paste).
        address: known ?? pasted,
        needsPaste: selectedKids.has(name) && !known,
      };
    });
  }, [kidNames, selectedKids, kidPaste, addrTick]);

  // The concrete recipient addresses wired to the create mutation. Depends on
  // mode; null entries (a selected kid with no address yet) block the button.
  const resolved = useMemo<{ addresses: string[]; ready: boolean; blocked: string[] }>(() => {
    if (mode === "myself") {
      return { addresses: publicKey ? [publicKey] : [], ready: !!publicKey, blocked: [] };
    }
    if (mode === "address") {
      const a = pasteAddr.trim();
      return { addresses: a ? [a] : [], ready: !!a, blocked: [] };
    }
    // kids
    const chosen = kidResolutions.filter((k) => k.selected);
    const addresses = chosen
      .map((k) => k.address)
      .filter((a): a is string => !!a);
    const blocked = chosen.filter((k) => !k.address).map((k) => k.name);
    return {
      addresses,
      // Ready only when at least one kid is chosen AND every chosen kid resolves.
      ready: chosen.length > 0 && blocked.length === 0,
      blocked,
    };
  }, [mode, publicKey, pasteAddr, kidResolutions]);

  // A friendly label for the "Dripping to" chip + live-state framing.
  const recipientLabel = useMemo(() => {
    if (mode === "myself") return "you";
    if (mode === "address") return "a pasted address";
    const names = kidResolutions.filter((k) => k.selected).map((k) => k.name);
    if (names.length === 0) return "nobody yet";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }, [mode, kidResolutions]);

  const recipientCount = resolved.addresses.length;

  // Honest total: at `rate` per period EACH, the pot drains at the combined rate,
  // so it lasts fund / (rate × count) periods. Shown so the parent sees the true
  // cost of adding kids.
  const totalSummary = useMemo(() => {
    if (rate <= 0 || fundXlm <= 0 || recipientCount === 0) return null;
    // "per week" for the rate line; the bare word ("week") for the duration line.
    const perLabel = PERIODS.find((p) => p.id === period)?.label ?? `per ${period}`;
    const periodWord = perLabel.replace("per ", "");
    const perLine =
      recipientCount === 1
        ? `${rate} XLM ${perLabel}`
        : `${rate} XLM ${perLabel} each, for ${recipientCount} kids`;
    const combined = rate * recipientCount;
    const lasts = combined > 0 ? fundXlm / combined : 0;
    const lastsLabel =
      lasts >= 1
        ? `about ${lasts.toFixed(1)} ${periodWord}${lasts >= 2 ? "s" : ""}`
        : `under one ${periodWord}`;
    return { perLine, lastsLabel };
  }, [rate, period, fundXlm, recipientCount]);

  const create = useCreateAllowance();
  const collect = useCollectAllowance();
  // Parent's own sender-side + (in myself mode) recipient-side state.
  const state = useAllowanceState(publicKey);

  const adjust = (setter: (fn: (v: number) => number) => void, delta: number) =>
    setter((v) => Math.max(0, Math.round((v + delta) * 100) / 100));

  // In "myself" mode the parent IS the recipient, so the scoop is real: what the
  // parent-wallet-as-kid can still pull right now (received-but-uncollected plus
  // the streamed-out amount a fresh receive would credit).
  const waiting = useMemo(() => {
    if (!state.data) return null;
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

  // Only in "myself" mode is the parent both sender and recipient, so a parent
  // scoop makes sense. For kid recipients, scooping is the KID's action on their
  // stash card — showing a 0/scoop here would be misleading.
  const showParentScoop = mode === "myself";

  // Only show the Scoop button when there is really something to scoop (above
  // dust) — no perpetual disabled button. And once the pot is drained to dust,
  // the allowance is DONE: mark it so and drop it out of the live section.
  const parentScoopable =
    waiting !== null && waiting >= DUST_STROOPS && hasReceivable && !!publicKey;
  const myselfDone =
    showParentScoop &&
    fundedRemaining < DUST_STROOPS &&
    (waiting ?? 0n) < DUST_STROOPS;
  // Distinguish "drained → done" from "never set one up": remember (this session)
  // whether the pot was ever funded, so a finished drip reads as Done rather than
  // "no allowance yet".
  const everFundedRef = useRef(false);
  useEffect(() => {
    if (fundedRemaining >= DUST_STROOPS || create.isSuccess)
      everFundedRef.current = true;
  }, [fundedRemaining, create.isSuccess]);
  const kidsPotEmpty = !showParentScoop && fundedRemaining < DUST_STROOPS;
  const kidsPotDone = kidsPotEmpty && everFundedRef.current;

  return (
    <div className="stagger-rise space-y-5">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Allowance</h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          A steady drip into your kid&apos;s stash, flowing every few seconds.
          Set the pace, fund it, and it pours in on its own.
        </p>
      </header>

      {/* Who it's dripping to. */}
      <div className="flex items-center gap-2 card-pop card-pop-sm bg-card/70 px-3.5 py-2.5">
        <DropIcon className="size-4 shrink-0 text-m-green-ink" weight="duotone" />
        <p className="min-w-0 flex-1 truncate text-[13px] font-extrabold text-foreground">
          Dripping to <span className="text-m-green-ink">{recipientLabel}</span>
        </p>
      </div>

      {/* ── Live allowance state ──────────────────────────────────────────────
          For kid recipients the parent is the SENDER, so we show the honest
          sender-side "still funded" and who it's flowing to. The scoop lives on
          the kid's stash card, not here. In "myself" mode the parent is also the
          recipient, so the scoop returns. */}
      {showParentScoop ? (
        <>
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
                {state.isLoading || waiting === null
                  ? "…"
                  : `${stroopsToXlm(waiting).toFixed(4)}`}
              </p>
              <span className="text-[11px] font-bold text-m-green-ink/70">XLM</span>
            </div>
          </div>

          {/* Scoop only when there's really something to scoop (above dust). */}
          {parentScoopable || collect.isPending ? (
            <button
              type="button"
              disabled={collect.isPending || !parentScoopable}
              onClick={() => publicKey && collect.mutate({ to: publicKey })}
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
          ) : myselfDone ? (
            <p className="text-center text-[13px] font-bold text-muted-foreground text-pretty">
              This allowance has finished. Start another below to keep it flowing.
            </p>
          ) : (
            <p className="text-center text-[12px] font-bold text-muted-foreground text-pretty">
              Nothing to scoop this second. It builds up as it drips.
            </p>
          )}
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
        </>
      ) : (
        // Kid recipients: the parent only funds + sends. Scooping is the kid's
        // move, so no scoop here. Once the pot drains to dust it's Done and drops
        // out of the live "still funded" framing (no misleading 0.0000 flowing).
        kidsPotEmpty ? (
          <div className="card-pop bg-muted/50 p-4">
            <span className="flex items-center gap-1.5 text-microlabel text-muted-foreground">
              <CheckCircleIcon className="size-3.5" weight="duotone" />
              {kidsPotDone ? "Allowance finished" : "No allowance yet"}
            </span>
            <p className="mt-1.5 text-[13px] font-bold text-muted-foreground text-pretty">
              {kidsPotDone
                ? `The drip to ${recipientLabel} has run out. Start another below to keep it flowing.`
                : `Set up an allowance below and it starts flowing to ${recipientLabel}.`}
            </p>
          </div>
        ) : (
          <div className="card-pop card-pop-butter p-4">
            <span className="flex items-center gap-1.5 text-microlabel text-muted-foreground">
              <PiggyBankIcon className="size-3.5" weight="duotone" />
              Still funded
            </span>
            <p className="mt-1 text-money text-2xl">
              {state.isLoading ? "…" : `${stroopsToXlm(fundedRemaining).toFixed(4)}`}
              <span className="ml-1 text-[11px] font-bold text-muted-foreground">
                XLM
              </span>
            </p>
            <p className="mt-1.5 text-[12px] font-semibold text-muted-foreground text-pretty">
              Flowing to {recipientLabel}. They scoop it up from their own stash.
            </p>
          </div>
        )
      )}

      {/* ── Set up a new allowance ────────────────────────────────────────── */}
      <section className="space-y-3 card-pop p-4">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <SparkleIcon className="size-4 text-m-gold" weight="fill" />
          Start an allowance
        </h2>

        {/* Recipient picker: multi-select kid chips + Myself + Paste address. */}
        <div>
          <p className="text-microlabel mb-1.5 text-muted-foreground">
            Drips to {mode === "kids" && recipientCount > 1 ? "(pick as many as you like)" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {kidNames.map((k) => {
              const on = mode === "kids" && selectedKids.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleKid(k)}
                  className={cn(
                    "press-pop relative flex items-center gap-1.5 rounded-full border-2 border-m-ink px-3 py-2 font-display text-xs font-extrabold shadow-[var(--m-pop-sm)]",
                    on ? "bg-primary text-primary-foreground" : "bg-card text-foreground",
                  )}
                >
                  <span className="flex size-5 items-center justify-center rounded-full border-2 border-m-ink bg-m-sky text-[10px] font-extrabold text-m-blue">
                    {k.charAt(0).toUpperCase()}
                  </span>
                  {k}
                  {on && (
                    <CheckCircleIcon
                      className="size-3.5 text-primary-foreground"
                      weight="fill"
                    />
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setMode("myself");
                setPasteAddr("");
              }}
              className={cn(
                "press-pop flex items-center gap-1.5 rounded-full border-2 border-m-ink px-3 py-2 font-display text-xs font-extrabold shadow-[var(--m-pop-sm)]",
                mode === "myself"
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
                setMode("address");
                setPasteAddr("");
              }}
              className={cn(
                "press-pop flex items-center gap-1.5 rounded-full border-2 border-m-ink px-3 py-2 font-display text-xs font-extrabold shadow-[var(--m-pop-sm)]",
                mode === "address"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground",
              )}
            >
              <ClipboardIcon className="size-3.5" weight="bold" />
              Paste address
            </button>
          </div>

          {/* Per-kid paste fields: one for each SELECTED kid whose address we
              don't know yet (labelled for that kid; saved to the map on start). */}
          {mode === "kids" &&
            kidResolutions
              .filter((k) => k.needsPaste)
              .map((k) => (
                <input
                  key={k.name}
                  type="text"
                  value={kidPaste[k.name] ?? ""}
                  onChange={(e) =>
                    setKidPaste((prev) => ({
                      ...prev,
                      [k.name]: e.target.value.trim(),
                    }))
                  }
                  placeholder={`Paste ${k.name}'s address (G…)`}
                  className="field-pop mt-2.5 w-full px-3.5 py-3 font-mono text-[13px] font-bold placeholder:font-display placeholder:font-bold placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-m-blue/50"
                />
              ))}

          {/* "Paste address" mode: one raw address field. */}
          {mode === "address" && (
            <input
              type="text"
              value={pasteAddr}
              onChange={(e) => setPasteAddr(e.target.value.trim())}
              placeholder="Paste an address (G…)"
              className="field-pop mt-2.5 w-full px-3.5 py-3 font-mono text-[13px] font-bold placeholder:font-display placeholder:font-bold placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-m-blue/50"
            />
          )}

          {/* A selected kid still missing an address after the paste is empty:
              tell the parent honestly they need to join (or paste it). */}
          {mode === "kids" && resolved.blocked.length > 0 && (
            <p className="mt-2 text-[12px] font-semibold text-muted-foreground text-pretty">
              {resolved.blocked.length === 1
                ? `${resolved.blocked[0]} hasn't joined yet. Paste their address above, or have them open the invite link first.`
                : `${resolved.blocked.join(", ")} haven't joined yet. Paste their addresses above, or have them open the invite link first.`}
            </p>
          )}
        </div>

        {/* Rate stepper */}
        <div className="field-pop flex items-center justify-between px-3.5 py-3">
          <div>
            <p className="text-microlabel text-muted-foreground">
              Rate {mode === "kids" && recipientCount > 1 ? "(each kid)" : ""}
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

        {/* Honest total: rate per kid, count, and how long the fund lasts. */}
        {totalSummary && (
          <div className="rounded-2xl border-2 border-dashed border-m-ink/25 bg-card/50 px-3.5 py-2.5">
            <p className="text-[13px] font-extrabold text-foreground">
              {totalSummary.perLine}
            </p>
            <p className="text-[12px] font-semibold text-muted-foreground">
              Your fund lasts {totalSummary.lastsLabel}.
            </p>
          </div>
        )}

        <button
          type="button"
          disabled={
            create.isPending ||
            setupState === "setting" ||
            fundXlm <= 0 ||
            rate <= 0 ||
            !resolved.ready
          }
          onClick={() => {
            if (!resolved.ready || resolved.addresses.length === 0) return;
            const targets = resolved.addresses;
            const chosenKidNames =
              mode === "kids"
                ? kidResolutions.filter((k) => k.selected).map((k) => k.name)
                : [];

            // Remember any freshly-pasted kid addresses for next time.
            if (mode === "kids") {
              for (const k of kidResolutions) {
                if (k.selected && !k.known && k.address) {
                  setKidAddress(k.name, k.address);
                }
              }
            }

            const startAllowance = () =>
              create.mutate(
                { recipients: targets, rate, period, fundXlm },
                {
                  onSuccess: () => {
                    // Post an allowance-started notice to EACH selected kid so
                    // their phone shows "Your allowance is flowing". Myself/raw
                    // address post nothing (no kid to notify).
                    for (const name of chosenKidNames) {
                      requestPostNotice({
                        id: `allowance-${name}-${randomId()}`,
                        at: Date.now(),
                        kind: "allowance-started",
                        kidName: name,
                        rateXlm: rate,
                        period,
                      });
                    }
                  },
                },
              );

            // "Myself" (or a target that is the parent's own wallet) already
            // exists → straight to the allowance.
            if (mode === "myself") {
              startAllowance();
              return;
            }

            // Otherwise bring every recipient account into existence FIRST
            // (createAccount + fund from the parent bank), so collect can't fail
            // op_no_destination. Idempotent — a known/existing account no-ops.
            // Skip the parent's own wallet if it happens to be in the list.
            setSetupState("setting");
            setSetupError(null);
            const toBootstrap = targets.filter((t) => t !== publicKey);
            void Promise.all(
              toBootstrap.map((to) => ensureAccountFunded({ from: keypair, to })),
            ).then((results) => {
              const bad = results.find(
                (r) => r.kind !== "exists" && r.kind !== "created",
              );
              if (!bad) {
                setSetupState("idle");
                startAllowance();
              } else {
                setSetupState("error");
                setSetupError(
                  bad.kind === "error" && bad.transient
                    ? "Couldn't reach the network to set up an account. Try again in a moment."
                    : "One of these addresses isn't set up on Stellar yet and the family bank couldn't fund it. Top up the bank and try again.",
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
              {recipientCount > 1 ? `Start allowance for ${recipientCount} kids` : "Start allowance"}
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
        {mode === "address" && resolved.ready && (
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

// Staged copy for the receive → split → collect pipeline (mirrors the stash card
// so the kid sees the same friendly words wherever they scoop).
const KID_SCOOP_COPY: Record<CollectStep, string> = {
  idle: "Scoop it up",
  receive: "Scooping…",
  split: "Pouring…",
  collect: "Pouring…",
  done: "Yours!",
  error: "Try again",
};

/** Turn an allowance period into the plain word a kid reads ("a week", "a day"). */
function periodPhrase(period: string | undefined): string {
  switch (period) {
    case "minute":
      return "a minute";
    case "hour":
      return "an hour";
    case "day":
      return "a day";
    case "week":
      return "a week";
    default:
      return "a week";
  }
}

/**
 * The KID's own allowance view. Their incoming drip, shown properly: who's
 * sending it and the rate (from the allowance-started notice their grown-up
 * posted), the live ticker + "Waiting to collect", and a "Scoop it up" that
 * collects into THEIR stash. This is the same on-chain path as the dashboard
 * stash card (useAllowanceDrip + useCollectAllowance) — just given room to
 * breathe on its own page. A friendly empty state when there's no allowance yet.
 */
function KidAllowanceView() {
  const { publicKey, refreshBalance } = useStellarWallet();
  const { family } = useFamily();
  const kidName = family?.kidName;
  const feed = useFamilyFeed();

  const drip = useAllowanceDrip(publicKey);
  const collect = useCollectAllowance();

  // The most recent allowance-started notice addressed to this kid, for the warm
  // "2 XLM a week from your grown-up" line. The drip itself is the on-chain truth;
  // this note is just friendly context, so its absence never blocks scooping.
  const startedNote = useMemo(() => {
    const mine = feed.filter(
      (e) =>
        e.kind === "allowance-started" &&
        (!e.kidName || !kidName || e.kidName === kidName) &&
        typeof e.rateXlm === "number",
    );
    return mine.length > 0 ? mine[0] : null; // feed is newest-first
  }, [feed, kidName]);

  // Staged scoop copy (the mutation is one promise; we time the stages to feel
  // like the pipeline underneath), matching the stash card's rhythm.
  const [step, setStep] = useState<CollectStep>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const waitingXlm = drip.waitingXlm;
  // Only scoop when there's really something above dust — no perpetual disabled
  // button when the number reads 0.0000.
  const scoopable = waitingXlm >= DUST_XLM;
  const canScoop = scoopable && !collect.isPending && !!publicKey;
  const scooping =
    collect.isPending || step === "receive" || step === "split" || step === "collect";

  const runScoop = () => {
    if (!canScoop || !publicKey) return;
    setStep("receive");
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => setStep("split"), 900),
      setTimeout(() => setStep("collect"), 1800),
    ];
    collect.mutate(
      { to: publicKey },
      {
        onSuccess: () => {
          timers.current.forEach(clearTimeout);
          setStep("done");
          void refreshBalance();
          timers.current = [setTimeout(() => setStep("idle"), 1600)];
        },
        onError: () => {
          timers.current.forEach(clearTimeout);
          setStep("error");
          timers.current = [setTimeout(() => setStep("idle"), 2200)];
        },
      },
    );
  };

  const hasAllowance = drip.hasIncoming || !!startedNote;
  const greetingName = kidName ? `${kidName}'s` : "Your";

  return (
    <div className="stagger-rise space-y-5">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          {greetingName} allowance
        </h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          A little drip of XLM into your stash, all the time. Watch it grow, then
          scoop it up whenever you like.
        </p>
      </header>

      {/* Who it's from + the rate (warm context from the grown-up's notice). */}
      {startedNote && (
        <div className="flex items-center gap-2 card-pop card-pop-sm bg-card/70 px-3.5 py-2.5">
          <HeartIcon className="size-4 shrink-0 text-m-pink" weight="duotone" />
          <p className="min-w-0 flex-1 text-[13px] font-extrabold text-foreground text-pretty">
            <span className="text-m-green-ink">
              {startedNote.rateXlm} XLM {periodPhrase(startedNote.period)}
            </span>{" "}
            from your grown-up.
          </p>
        </div>
      )}

      {hasAllowance ? (
        scoopable || scooping || step === "done" || step === "error" ? (
        <>
          {/* Live drip: "Dripping in" + waiting total (ticks between polls). */}
          <div className="card-pop card-pop-mint p-4">
            <span className="flex items-center gap-1.5 text-microlabel text-m-green-ink">
              <DropIcon className="size-3.5" weight="duotone" />
              Waiting to collect
            </span>
            <p className="mt-1 flex items-baseline gap-1 text-money text-3xl text-m-green-ink tabular-nums">
              {drip.isLoading ? "…" : waitingXlm.toFixed(4)}
              <span className="text-[13px] font-bold text-m-green-ink/70">XLM</span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] font-bold text-m-green-ink/80">
              <span
                aria-hidden
                className="drip-dot flex size-4 items-center justify-center rounded-full bg-m-mint text-m-green-ink"
              >
                <DropIcon className="size-3" weight="fill" />
              </span>
              Dripping in, all on its own.
            </p>
          </div>

          {/* Scoop it up — collects into THIS kid's stash (same pipeline as the
              stash card). Enabled only when there's something to pull. */}
          <button
            type="button"
            disabled={!canScoop && !scooping}
            onClick={runScoop}
            className="press-pop flex h-14 w-full items-center justify-center gap-2 rounded-full border-2 border-m-ink bg-primary font-display text-lg font-extrabold text-primary-foreground shadow-[var(--m-pop)] hover:brightness-[1.03] disabled:opacity-50"
          >
            {scooping ? (
              <>
                <SpinnerGapIcon className="size-5 animate-spin" weight="bold" />
                {KID_SCOOP_COPY[step === "idle" ? "receive" : step]}
              </>
            ) : step === "done" ? (
              <>
                <SparkleIcon className="size-5" weight="fill" />
                {KID_SCOOP_COPY.done}
              </>
            ) : (
              <>
                <DownloadSimpleIcon className="size-5" weight="bold" />
                Scoop it up
              </>
            )}
          </button>

          {step === "done" && (
            <p className="text-center text-[13px] font-extrabold text-m-green-ink">
              Scooped into your stash! 🪙
            </p>
          )}
          {step === "error" && (
            <p className="text-center text-[13px] font-bold text-m-pink text-pretty">
              {collect.errorMessage ??
                "The bank line is busy. Your money is safe, try again in a moment."}
            </p>
          )}
          {!scooping && step !== "error" && waitingXlm > 0 && (
            <p className="text-center text-[11px] font-bold text-m-green-ink/55 text-pretty">
              This comes in on its own too. Tap if you like.
            </p>
          )}
        </>
        ) : (
          // Nothing to scoop right now: calm and honest, no dead scoop button.
          <div className="card-pop bg-muted/40 p-4">
            <span className="flex items-center gap-1.5 text-microlabel text-muted-foreground">
              {drip.hasIncoming ? (
                <DropIcon className="size-3.5" weight="duotone" />
              ) : (
                <CheckCircleIcon className="size-3.5" weight="duotone" />
              )}
              {drip.hasIncoming ? "Dripping in" : "All caught up"}
            </span>
            <p className="mt-1.5 text-[13px] font-bold text-muted-foreground text-pretty">
              {drip.hasIncoming
                ? "It's flowing in on its own. Nothing to scoop just this second."
                : "You've scooped it all. It drips in again when your grown-up adds more."}
            </p>
          </div>
        )
      ) : (
        // No allowance yet: a warm empty state (never a sad zero / dead scoop).
        <div className="card-pop card-pop-butter flex flex-col items-center gap-2 p-6 text-center">
          <span className="flex size-14 items-center justify-center rounded-full border-2 border-m-ink bg-m-mint">
            <DropIcon className="size-7 text-m-green-ink" weight="duotone" />
          </span>
          <p className="font-display text-lg font-extrabold text-foreground">
            No allowance yet
          </p>
          <p className="text-[13px] font-bold text-muted-foreground text-pretty">
            Ask your grown-up to start one. When they do, it drips in here for you
            to scoop.
          </p>
        </div>
      )}
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
