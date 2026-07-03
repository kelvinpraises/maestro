// use-rewards.ts — Stellar-native private-reward hooks backed by the `zwerc20`
// family-treasury contract. This is the private-claim counterpart to
// use-allowance.ts (which drives the `drips` streaming contract).
//
// Product vocabulary:
//   • "Fund a reward" (parent): deposit XLM into the family treasury behind a
//     fresh, secret claim note. The public ledger never links the deposit to
//     who eventually claims it.
//   • "Claimable rewards" (kid): the notes stored on this device that haven't
//     been spent yet.
//   • "Claim privately" (kid): rebuild the treasury's Merkle tree, prove the
//     note in the browser (snarkjs), and remint — real XLM lands in the wallet.
//
// Notes are demo-grade: stored in localStorage (no server, no custody). In a
// real product the parent would hand the note to the kid out-of-band.

import { useCallback, useEffect, useState } from "react";
import { Buffer } from "buffer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zwerc20 as zwRead, withSigner } from "@/contracts/stellar";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import {
  buildWitness,
  deriveNote,
  freshSecret,
  generateProof,
  rebuildTree,
  toField,
  type ClaimNote,
} from "@/lib/claims";
import { xlmToStroops, stroopsToXlm } from "@/lib/allowance";
import { classifyTxError, retryTransient } from "@/lib/tx-errors";
import { ensureStashFunded } from "@/lib/account";
import { RELAYER, relayerSign } from "@/config/stellar";

// ── local note storage (demo-grade) ──────────────────────────────────────────

const NOTES_STORAGE_KEY = "maestro.reward-notes.v1";

function loadNotes(): ClaimNote[] {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClaimNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveNotes(notes: ClaimNote[]): void {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // Non-fatal in the demo — the note just won't persist across reloads.
  }
}

/** Notify same-tab listeners (localStorage `storage` event only fires cross-tab). */
const NOTES_EVENT = "maestro:reward-notes-changed";
function emitNotesChanged() {
  window.dispatchEvent(new Event(NOTES_EVENT));
}

// ── useMyRewards — the notes on this device ───────────────────────────────────

export interface RewardView extends ClaimNote {
  /** Reward size as a display XLM number. */
  amountXlm: number;
  /** Spent yet? (Checked against the on-chain nullifier set.) */
  claimed: boolean;
}

/**
 * List the claim notes stored on this device, enriched with on-chain "already
 * claimed?" status (the nullifier set is the source of truth, so a note claimed
 * on another device still shows as claimed here).
 */
export function useMyRewards() {
  const [notes, setNotes] = useState<ClaimNote[]>(() =>
    typeof window === "undefined" ? [] : loadNotes(),
  );

  useEffect(() => {
    const reload = () => setNotes(loadNotes());
    window.addEventListener(NOTES_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(NOTES_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const query = useQuery<RewardView[]>({
    queryKey: ["reward-notes", notes.map((n) => n.id).join(",")],
    staleTime: 5_000,
    refetchInterval: 10_000,
    queryFn: async () => {
      const enriched = await Promise.all(
        notes.map(async (n) => {
          const derived = deriveNote(BigInt(n.secret), BigInt(n.amountStroops));
          let claimed = false;
          try {
            claimed = (
              await zwRead.is_nullifier_used({ nullifier: derived.nullifier })
            ).result;
          } catch {
            // Network hiccup — treat as unknown (not claimed) so the kid can try.
            claimed = false;
          }
          return {
            ...n,
            amountXlm: stroopsToXlm(BigInt(n.amountStroops)),
            claimed,
          };
        }),
      );
      // Newest first.
      return enriched.sort((a, b) => b.createdAt - a.createdAt);
    },
  });

  // Attach `notes` without spreading the query — spreading a discriminated
  // union (UseQueryResult) collapses `data` to `never`.
  return Object.assign(query, { notes });
}

// ── useFundReward — parent deposits a private reward ──────────────────────────

export interface FundRewardParams {
  /** Reward size in XLM. */
  amountXlm: number;
  /** Optional human label ("Cleaned room", …). */
  label?: string;
}

export interface FundRewardResult {
  note: ClaimNote;
  leafIndex: number;
}

/**
 * Parent funds a private reward: derive a fresh note, compute its privacy
 * address, deposit the XLM into the treasury (which inserts the commitment),
 * then persist the note locally with its amount + leaf index.
 */
export function useFundReward() {
  const queryClient = useQueryClient();
  const { publicKey, signTransaction, refreshBalance } = useStellarWallet();

  return useMutation<FundRewardResult, Error, FundRewardParams>({
    mutationFn: async ({ amountXlm, label }) => {
      const amountStroops = xlmToStroops(amountXlm);
      if (amountStroops <= 0n) {
        throw new Error("Reward must be more than 0 XLM.");
      }

      const secret = freshSecret();
      const derived = deriveNote(secret, amountStroops);

      // Deposit is a money tx too — a transient blip on submit gets a bounded
      // retry with backoff; a deterministic reject (e.g. bank too low) surfaces
      // at once. Single-use AssembledTransaction rebuilt per attempt.
      const { zwerc20 } = withSigner({ publicKey, signTransaction });
      const leafIndex = await retryTransient(async () => {
        const tx = await zwerc20.deposit({
          from: publicKey,
          addr20: derived.addr20,
          amount: amountStroops,
        });
        return (await tx.signAndSend()).result;
      }, "fund");

      const note: ClaimNote = {
        id: "0x" + derived.nullifier.toString(16).padStart(64, "0"),
        secret: secret.toString(),
        amountStroops: amountStroops.toString(),
        leafIndex,
        createdAt: Date.now(),
        label,
      };

      const next = [...loadNotes().filter((n) => n.id !== note.id), note];
      saveNotes(next);
      emitNotesChanged();

      return { note, leafIndex };
    },
    onSuccess: async () => {
      await refreshBalance();
      queryClient.invalidateQueries({ queryKey: ["reward-notes"] });
    },
  });
}

// ── useClaimReward — kid proves + remints a note ──────────────────────────────

export type ClaimStep =
  | "idle"
  | "rebuilding"
  | "proving"
  | "submitting"
  | "done"
  | "error";

export interface ClaimRewardParams {
  note: ClaimNote;
  /**
   * Where the reward is paid. Defaults to the kid's PRIVATE STASH — the whole
   * point of the split. Callers should almost never override this; it exists
   * only for edge tooling.
   */
  to?: string;
}

export interface ClaimRewardResult {
  amountStroops: bigint;
}

/**
 * Kid claims a reward privately, into their STASH, via the RELAYER.
 *
 * Privacy design (context/TWO-WALLET-PRIVACY.md): the reward is proved for
 * `to = stash` in-browser, then a neutral shared RELAYER submits the
 * `remint(to = stash)` — the tx is sourced + signed by the relayer key, NOT by
 * the kid. `zwerc20::remint` has no `require_auth`, so any account may submit it;
 * the proof binds the payout to `stash`, so the relayer can only pay gas and
 * forward an unstealable payout. On-chain the claim comes from the relayer (the
 * anonymity set) and lands in a fresh stash the relayer paid — nothing links it
 * to this kid. The kid's spending wallet signs nothing here (and need not exist).
 *
 * Rebuilds the treasury's Merkle tree from on-chain leaves, generates the
 * Groth16 proof (CPU-bound, ~10s+), ensures the stash's base reserve exists
 * (relayer-funded), then remints. Refreshes the wallet balance on success.
 */
export function useClaimReward() {
  const queryClient = useQueryClient();
  const { stash, refreshBalance } = useStellarWallet();
  const [step, setStep] = useState<ClaimStep>("idle");

  const mutation = useMutation<ClaimRewardResult, Error, ClaimRewardParams>({
    mutationFn: async ({ note, to }) => {
      // The reward lands in the private stash by default. No kid-owned wallet
      // signs or is named on-chain for this claim.
      const recipient = to?.trim() || stash.publicKey;
      const amountStroops = BigInt(note.amountStroops);
      const derived = deriveNote(BigInt(note.secret), amountStroops);

      // 1) Rebuild the tree from on-chain leaves (paginated, includes pre-existing).
      setStep("rebuilding");
      const tree = await rebuildTree(zwRead);
      const root = tree.root;
      const { pathElements, pathIndices } = tree.proof(note.leafIndex);

      // 2) Prove in the browser (binds the payout to `recipient` = stash).
      setStep("proving");
      const witness = buildWitness({
        note: derived,
        recipient,
        root,
        pathElements,
        pathIndices,
      });
      const { proofBytes } = await generateProof(witness);

      // 3) Ensure the stash exists on-chain (the SAC transfer needs a live
      //    destination). The RELAYER creates + funds its base reserve — never
      //    the spending wallet or the parent, which would publicly link the
      //    stash. Idempotent + never throws; a deterministic failure (relayer
      //    bank empty) is surfaced, a transient one is retried below with submit.
      setStep("submitting");
      if (recipient === stash.publicKey) {
        const ensured = await ensureStashFunded(stash.publicKey);
        if (ensured.kind === "error" && !ensured.transient) {
          throw new Error(`stash setup failed: ${ensured.detail}`);
        }
      }

      // 4) Remint, SUBMITTED BY THE RELAYER (its key sources + signs the tx).
      //    Wrapped in a transient-only retry: a network/RPC blip on submit gets
      //    another turn with backoff, but a deterministic ledger reject (e.g.
      //    this note already claimed) is surfaced immediately — never dressed up
      //    as "busy, try again". The proof + root are computed once above and
      //    reused; only the single-use AssembledTransaction is rebuilt per
      //    attempt. `relayer_fee = 0` as today (the demo relayer takes no cut).
      const { zwerc20 } = withSigner({
        publicKey: RELAYER.publicKey,
        signTransaction: relayerSign(),
      });
      const proof = Buffer.from(proofBytes);
      await retryTransient(async () => {
        const tx = await zwerc20.remint({
          to: recipient,
          amount: amountStroops,
          root,
          nullifier: derived.nullifier,
          relayer_fee: 0n,
          proof,
        });
        await tx.signAndSend();
      }, "claim");

      setStep("done");
      return { amountStroops };
    },
    onSuccess: async () => {
      await refreshBalance();
      queryClient.invalidateQueries({ queryKey: ["reward-notes"] });
    },
    onError: () => setStep("error"),
  });

  const reset = useCallback(() => {
    setStep("idle");
    mutation.reset();
  }, [mutation]);

  // Kid-safe, truthful copy for the failure card — distinguishes a genuine
  // network blip ("bank line is busy … try again") from a deterministic reject
  // (already claimed / not enough in the bank), rather than lying "try again" at
  // something that can't succeed. The relayer pays gas now, so there is no
  // longer a kid-wallet-unfunded case to special-case here. Null until there's
  // an error to describe.
  const errorMessage = mutation.error
    ? classifyTxError(mutation.error, "claim").kidMessage
    : null;

  return { ...mutation, step, reset, errorMessage };
}

// Re-export for callers that want the field encoding (e.g. share links).
export { toField };
