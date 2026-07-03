// use-allowance.ts — Stellar-native allowance hooks backed by the `drips`
// streaming contract. This is the Maestro replacement for the retired EVM
// streaming hooks.
//
// Product vocabulary: an "allowance" is a drips stream of native XLM from a
// parent's wallet to a recipient (a kid, or — in the single-wallet demo — the
// parent's own wallet). The kid's money arrives via receive → split → collect.
//
// Gotchas baked in (see src/lib/allowance.ts): explicit cycle-aligned future
// start + explicit duration on create; bounded max_cycles on collect. The
// engine runs 2-second cycles.

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { drips as dripsRead, withSigner } from "@/contracts/stellar";
import { recordScoop } from "@/lib/family";
import { CONTRACT_IDS } from "@/config/stellar";
import { classifyTxError, retryTransient } from "@/lib/tx-errors";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import {
  AllowancePeriod,
  amtPerSecFromRate,
  buildAllowanceReceiver,
  CYCLE_SECS,
  cycleAlignedStart,
  MAX_RECEIVE_CYCLES,
  maxCyclesForElapsed,
  sortReceivers,
  stroopsPerSec,
  xlmToStroops,
} from "@/lib/allowance";

const TOKEN = CONTRACT_IDS.underlying;

// ── shared signer bundle from the in-app wallet ──────────────────────────────

function useSignerBundle() {
  const { publicKey, signTransaction } = useStellarWallet();
  return useCallback(
    () => withSigner({ publicKey, signTransaction }),
    [publicKey, signTransaction],
  );
}

// ── useCreateAllowance ───────────────────────────────────────────────────────

export interface CreateAllowanceParams {
  /**
   * Where the allowance streams to. The primary shape is a LIST — each recipient
   * gets its own stream at the shared `rate`/`period`, and the funding covers the
   * sum. A single `recipient` string is still accepted (back-compat with the old
   * single-kid flow and the node e2e harness); when both are given, `recipients`
   * wins. Empty/unset ⇒ the parent's own wallet (the single-device demo path).
   */
  recipients?: string[];
  /** Legacy single recipient. Superseded by `recipients` when that's present. */
  recipient?: string;
  /** Rate as XLM per period. Applied to EACH recipient. */
  rate: number;
  period: AllowancePeriod;
  /**
   * Total XLM to fund the allowance with (the deposit that moves into the vault).
   * This is the whole pot, split across all recipients by the contract as each
   * stream drains — so it must cover the SUM of every recipient's rate for the
   * intended run.
   */
  fundXlm: number;
  /** Optional distinct stream id (shared by every receiver in this call). */
  streamId?: bigint;
}

export interface CreateAllowanceResult {
  /** Real deposit delta the contract applied, in stroops. */
  appliedDelta: bigint;
  /** Per-recipient fixed-point rate (same for every recipient). */
  amtPerSec: bigint;
  start: bigint;
  /**
   * Duration the pot sustains across ALL recipients at the combined rate
   * (funding / (perSec × recipientCount)). One recipient reduces to the old
   * single-stream duration.
   */
  duration: bigint;
  /** How many recipient streams this allowance opened. */
  recipientCount: number;
  /** The concrete addresses streamed to (sorted, deduped) — for the UI/notices. */
  recipients: string[];
}

/**
 * Parent opens an allowance to one OR MORE recipients. Each recipient gets its
 * own stream at the shared rate; the funded pot covers the sum. Pins an explicit
 * future cycle-aligned `start` and an explicit per-stream `duration` derived from
 * the funded amount and the COMBINED rate, sorts the receiver list into the strict
 * order `set_streams` requires (account bytes, then config), then submits one
 * `set_streams` (which replaces the sender's entire receiver set) via the
 * signer-bound client.
 */
export function useCreateAllowance() {
  const queryClient = useQueryClient();
  const { publicKey } = useStellarWallet();
  const makeSigner = useSignerBundle();

  return useMutation<CreateAllowanceResult, Error, CreateAllowanceParams>({
    mutationFn: async ({ recipients, recipient, rate, period, fundXlm, streamId = 0n }) => {
      const account = publicKey;

      // Normalize the target list: prefer `recipients`, fall back to the legacy
      // single `recipient`, else the parent's own wallet. Trim, drop blanks, and
      // dedupe by address so the same kid picked twice can't split the pot.
      const rawTargets =
        recipients && recipients.length > 0
          ? recipients
          : recipient?.trim()
            ? [recipient]
            : [account];
      const targets = Array.from(
        new Set(rawTargets.map((a) => a.trim()).filter(Boolean)),
      );
      if (targets.length === 0) {
        throw new Error("Pick at least one person to send the allowance to.");
      }

      const amtPerSec = amtPerSecFromRate(rate, period);
      const perSec = stroopsPerSec(amtPerSec);
      if (perSec <= 0n) {
        throw new Error("Allowance rate is too small to stream.");
      }

      const funding = xlmToStroops(fundXlm);
      if (funding <= 0n) {
        throw new Error("Fund the allowance with more than 0 XLM.");
      }

      // Duration the pot sustains at the COMBINED rate (every recipient drains at
      // `perSec`, so the whole set drains at `perSec × count`). Cap so each stream
      // has a definite, bounded end rather than an open-ended one.
      const combinedPerSec = perSec * BigInt(targets.length);
      const duration = funding / combinedPerSec;
      if (duration <= 0n) {
        throw new Error(
          "Funding is too small for even one second across these recipients.",
        );
      }

      const nowSecs = Math.floor(Date.now() / 1000);
      const start = BigInt(cycleAlignedStart(nowSecs, CYCLE_SECS));

      // One receiver per recipient, all at the shared rate/start/duration, then
      // sorted + deduped into the strict order the contract's build_configs check
      // demands (account bytes ascending, then config). set_streams REPLACES the
      // sender's whole receiver set, so this list is the complete active set.
      const newReceivers = sortReceivers(
        targets.map((to) =>
          buildAllowanceReceiver({ account: to, amtPerSec, start, duration, streamId }),
        ),
      );

      const { drips } = makeSigner();
      const tx = await drips.set_streams({
        account,
        token: TOKEN,
        new_receivers: newReceivers,
        balance_delta: funding,
        max_end_hint1: 0n,
        max_end_hint2: 0n,
      });
      const sent = await tx.signAndSend();

      return {
        appliedDelta: sent.result,
        amtPerSec,
        start,
        duration,
        recipientCount: newReceivers.length,
        recipients: newReceivers.map((r) => r.account),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allowance-state"] });
    },
  });
}

// ── useAllowanceState ────────────────────────────────────────────────────────

export interface AllowanceState {
  /** Sender-side funded balance remaining (stroops). */
  fundedRemaining: bigint;
  /** Timestamp at which the funded balance is exhausted. */
  maxEnd: bigint;
  /** Amount already waiting in whole received-but-unsplit cycles (stroops). */
  splittable: bigint;
  /** Amount split and ready to collect (stroops). */
  collectable: bigint;
  /** Whole elapsed cycles not yet received. */
  receivableCycles: bigint;
  /**
   * Streamed-out-but-not-yet-received amount (stroops): money that has flowed to
   * this account and would be credited on the next `receive`, but hasn't been
   * pulled into `splittable`/`collectable` yet. This is the honest source for the
   * stash card's "waiting" drip (splittable + collectable stay 0 until a scoop
   * runs `receive`), and it is measured two independent ways, whichever is larger:
   *
   *   • RECEIVER side — a read-only SIMULATION of `receive_streams` (capped at
   *     MAX_RECEIVE_CYCLES) returns the exact amount a real receive would credit,
   *     WITHOUT committing. This is the only term that is non-zero for a pure
   *     recipient (a kid), whose own `streams_state.balance` is 0, so it's what
   *     lights up the kid's stash card before their first scoop.
   *   • SENDER side — settled balance (`balance` at `update_time`) minus the live
   *     drained balance (`balance_at(now)`). Non-zero for a sender streaming to
   *     itself (the single-device "myself" demo), where the account is both ends.
   */
  receivableStreamed: bigint;
}

/**
 * Poll the allowance state for a wallet: how much is still funded as a sender,
 * and how much is waiting to be collected as a recipient (the streamed-out
 * amount that a `receive` would credit, plus already-received splittable +
 * collectable, plus the count of receivable cycles). All simulate-only reads.
 */
export function useAllowanceState(address: string | undefined) {
  return useQuery<AllowanceState>({
    queryKey: ["allowance-state", address],
    enabled: !!address,
    staleTime: 5_000,
    refetchInterval: 5_000,
    queryFn: async () => {
      const account = address!;
      const nowSecs = BigInt(Math.floor(Date.now() / 1000));
      const [stateTx, splittableTx, collectableTx, cyclesTx, balanceNowTx] =
        await Promise.all([
          dripsRead.streams_state({ account, token: TOKEN }),
          dripsRead.splittable({ account, token: TOKEN }),
          dripsRead.collectable({ account, token: TOKEN }),
          dripsRead.receivable_streams_cycles({ account, token: TOKEN }),
          // Live drained balance at "now". `balance_at` panics if the timestamp
          // predates the last update; clamp defensively to update_time below by
          // never asking for a time earlier than the settled snapshot.
          dripsRead
            .balance_at({ account, token: TOKEN, timestamp: nowSecs })
            .then((tx) => tx.result)
            .catch(() => null),
        ]);
      const [, updateTime, maxEnd, balance] = stateTx.result;
      const receivableCycles = cyclesTx.result;

      // SENDER-side streamed-but-unreceived = settled balance − live balance.
      // Non-zero when the account streams to ITSELF (the "myself" demo). Clamp to
      // [0, balance] so a stale/racey read can't claim more than the balance pays.
      let senderStreamed = 0n;
      if (balanceNowTx !== null && nowSecs >= updateTime) {
        const drained = balance - balanceNowTx;
        senderStreamed = drained < 0n ? 0n : drained > balance ? balance : drained;
      }

      // RECEIVER-side waiting = a read-only SIMULATION of `receive_streams`. For a
      // pure recipient (a kid) the sender term above is 0 (their own sender
      // balance is 0), so this is the ONLY thing that makes the stash card light
      // up before the first scoop. Simulating (no signAndSend) returns the exact
      // amount a real receive would credit, WITHOUT committing — the honest,
      // chain-truth "waiting". Capped at MAX_RECEIVE_CYCLES to match the collect
      // pipeline's bound (and keep the simulate cheap). Only run when there are
      // whole cycles to receive; a transient sim failure degrades to 0.
      let receiverStreamed = 0n;
      if (receivableCycles > 0n) {
        const simCycles = Math.min(MAX_RECEIVE_CYCLES, Number(receivableCycles));
        try {
          const simTx = await dripsRead.receive_streams({
            account,
            token: TOKEN,
            max_cycles: simCycles,
          });
          const credited = simTx.result;
          if (credited > 0n) receiverStreamed = credited;
        } catch {
          // A blip in the simulate → fall back to 0 (the ticker just holds).
        }
      }

      // The waiting drip takes whichever side actually has money flowing to this
      // account. They are mutually exclusive in practice (a pure sender has no
      // receivable cycles; a pure receiver has no sender balance), so max() picks
      // the right one and the "myself" case, where both can be non-zero, is still
      // bounded by the real streamed amount.
      const receivableStreamed =
        receiverStreamed > senderStreamed ? receiverStreamed : senderStreamed;

      return {
        fundedRemaining: balance,
        maxEnd,
        splittable: splittableTx.result,
        collectable: collectableTx.result,
        receivableCycles,
        receivableStreamed,
      };
    },
  });
}

// ── useCollectAllowance ──────────────────────────────────────────────────────

export type CollectStep = "idle" | "receive" | "split" | "collect" | "done" | "error";

export interface CollectAllowanceParams {
  /** Where the collected XLM is paid out. Defaults to the wallet itself. */
  to?: string;
}

export interface CollectAllowanceResult {
  received: bigint;
  collected: bigint;
}

/**
 * Kid-side: run the full receive → split → collect pipeline with bounded
 * params, then refresh the wallet's XLM balance. `collect` pays real XLM to
 * `to`.
 */
export function useCollectAllowance() {
  const queryClient = useQueryClient();
  const { publicKey, refreshBalance } = useStellarWallet();
  const makeSigner = useSignerBundle();

  const mutation = useMutation<CollectAllowanceResult, Error, CollectAllowanceParams | void>({
    mutationFn: async (params) => {
      const account = publicKey;
      const to = params?.to?.trim() || account;
      const { drips } = makeSigner();

      // How many cycles have elapsed since this account first had a receivable
      // stream. We don't know the exact start here, so bound generously from
      // the receivable-cycle count the contract reports.
      const cyclesTx = await dripsRead.receivable_streams_cycles({
        account,
        token: TOKEN,
      });
      const receivable = Number(cyclesTx.result);
      const maxCycles = maxCyclesForElapsed(receivable * CYCLE_SECS, CYCLE_SECS);

      // Each leg is wrapped in a transient-only retry: a network/RPC blip mid-
      // pipeline gets another turn with backoff, but a deterministic reject is
      // surfaced at once (never mislabeled "busy, try again"). Single-use
      // AssembledTransactions are rebuilt per attempt. Pipeline logic unchanged.

      // 1) receive up to `maxCycles` whole elapsed cycles into splittable.
      const received = await retryTransient(async () => {
        const receiveTx = await drips.receive_streams({
          account,
          token: TOKEN,
          max_cycles: maxCycles,
        });
        return (await receiveTx.signAndSend()).result;
      }, "collect");

      // 2) split (no sub-receivers ⇒ everything becomes collectable).
      await retryTransient(async () => {
        const splitTx = await drips.split({ account, token: TOKEN });
        await splitTx.signAndSend();
      }, "collect");

      // 3) collect → pays real XLM out to `to`.
      const collected = await retryTransient(async () => {
        const collectTx = await drips.collect({ account, token: TOKEN, to });
        return (await collectTx.signAndSend()).result;
      }, "collect");

      return { received, collected };
    },
    onSuccess: async ({ collected }) => {
      // Record the scoop so "earned this week" counts allowance the kid watched
      // land, not just claimed rewards (audit issue 5). Only a positive collect
      // is worth logging.
      if (collected > 0n) recordScoop(collected.toString());
      await refreshBalance();
      queryClient.invalidateQueries({ queryKey: ["allowance-state"] });
    },
  });

  // Kid-safe, truthful copy for the scoop's failure card — a genuine blip reads
  // "bank line is busy … try again", a deterministic reject reads the honest
  // reason instead of a retry that can't win. Null until there's an error.
  const errorMessage = mutation.error
    ? classifyTxError(mutation.error, "collect").kidMessage
    : null;

  return Object.assign(mutation, { errorMessage });
}
