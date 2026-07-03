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
import { CONTRACT_IDS } from "@/config/stellar";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import {
  AllowancePeriod,
  amtPerSecFromRate,
  buildAllowanceReceiver,
  CYCLE_SECS,
  cycleAlignedStart,
  maxCyclesForElapsed,
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
  /** Where the allowance streams to. Defaults to the parent's own wallet. */
  recipient?: string;
  /** Rate as XLM per period. */
  rate: number;
  period: AllowancePeriod;
  /** Total XLM to fund the allowance with (the deposit that moves into the vault). */
  fundXlm: number;
  /** Optional distinct stream id (for multiple concurrent allowances). */
  streamId?: bigint;
}

export interface CreateAllowanceResult {
  /** Real deposit delta the contract applied, in stroops. */
  appliedDelta: bigint;
  amtPerSec: bigint;
  start: bigint;
  duration: bigint;
}

/**
 * Parent opens an allowance. Pins an explicit future cycle-aligned `start` and
 * an explicit `duration` derived from the funded amount and rate, then submits
 * `set_streams` via the signer-bound client.
 */
export function useCreateAllowance() {
  const queryClient = useQueryClient();
  const { publicKey } = useStellarWallet();
  const makeSigner = useSignerBundle();

  return useMutation<CreateAllowanceResult, Error, CreateAllowanceParams>({
    mutationFn: async ({ recipient, rate, period, fundXlm, streamId = 0n }) => {
      const account = publicKey;
      const to = recipient?.trim() || account;

      const amtPerSec = amtPerSecFromRate(rate, period);
      const perSec = stroopsPerSec(amtPerSec);
      if (perSec <= 0n) {
        throw new Error("Allowance rate is too small to stream.");
      }

      const funding = xlmToStroops(fundXlm);
      if (funding <= 0n) {
        throw new Error("Fund the allowance with more than 0 XLM.");
      }

      // Duration the funded amount can sustain at this rate. Cap so the stream
      // has a definite, bounded end rather than an open-ended one.
      const duration = funding / perSec;
      if (duration <= 0n) {
        throw new Error("Funding is too small for even one second at this rate.");
      }

      const nowSecs = Math.floor(Date.now() / 1000);
      const start = BigInt(cycleAlignedStart(nowSecs, CYCLE_SECS));

      const receiver = buildAllowanceReceiver({
        account: to,
        amtPerSec,
        start,
        duration,
        streamId,
      });

      const { drips } = makeSigner();
      const tx = await drips.set_streams({
        account,
        token: TOKEN,
        new_receivers: [receiver],
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
}

/**
 * Poll the allowance state for a wallet: how much is still funded as a sender,
 * and how much is waiting to be collected as a recipient (splittable +
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
      const [stateTx, splittableTx, collectableTx, cyclesTx] = await Promise.all([
        dripsRead.streams_state({ account, token: TOKEN }),
        dripsRead.splittable({ account, token: TOKEN }),
        dripsRead.collectable({ account, token: TOKEN }),
        dripsRead.receivable_streams_cycles({ account, token: TOKEN }),
      ]);
      const [, , maxEnd, balance] = stateTx.result;
      return {
        fundedRemaining: balance,
        maxEnd,
        splittable: splittableTx.result,
        collectable: collectableTx.result,
        receivableCycles: cyclesTx.result,
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

  return useMutation<CollectAllowanceResult, Error, CollectAllowanceParams | void>({
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

      // 1) receive up to `maxCycles` whole elapsed cycles into splittable.
      const receiveTx = await drips.receive_streams({
        account,
        token: TOKEN,
        max_cycles: maxCycles,
      });
      const receiveSent = await receiveTx.signAndSend();
      const received = receiveSent.result;

      // 2) split (no sub-receivers ⇒ everything becomes collectable).
      const splitTx = await drips.split({ account, token: TOKEN });
      await splitTx.signAndSend();

      // 3) collect → pays real XLM out to `to`.
      const collectTx = await drips.collect({ account, token: TOKEN, to });
      const collectSent = await collectTx.signAndSend();
      const collected = collectSent.result;

      return { received, collected };
    },
    onSuccess: async () => {
      await refreshBalance();
      queryClient.invalidateQueries({ queryKey: ["allowance-state"] });
    },
  });
}
