// account.ts — Stellar account existence + parent-funded account creation.
//
// THE BUG THIS FIXES. Maestro's in-app wallet is NOT account-abstracted: a
// freshly generated ed25519 keypair does not exist on-chain until it is funded
// with the base reserve (~1 XLM). Until then the account has no balance and
// cannot pay a transaction fee. Two real failures fall out of that:
//
//   • A kid's device can't submit the reward-claim (`remint`) tx — its own
//     account doesn't exist, so there's nothing to pay the fee with. The claim
//     fails and surfaces as the generic "bank line is busy".
//   • An allowance/stream `collect` (or any payment) to a fresh or pasted
//     address fails with `op_no_destination` — you can't pay an account that
//     isn't there.
//
// THE FIX (Stellar-native, no new contract). The PARENT holds XLM (the family
// bank), so the parent is made responsible for bringing family accounts into
// existence. When the parent learns a kid's G-address — a kid joins and
// publishes it to the board, or the parent pastes one — the parent device
// submits a classic `createAccount` op funding it with a small starting balance
// (default 1 XLM). Idempotent: if the account already exists, this no-ops; each
// address is funded at most once (tracked locally so a re-render / re-poll never
// re-sends).
//
// This is a classic (non-Soroban) Stellar transaction: build with
// TransactionBuilder, sign with the in-app Keypair, submit via the same Soroban
// RPC server the rest of the app uses, and poll to confirmation. React-free so
// it can be unit-tested and driven from a node harness.

import {
  Account,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  Horizon,
  rpc as StellarRpc,
} from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "@/config/stellar";
import { classifyTxError } from "@/lib/tx-errors";

const { networkPassphrase, horizonUrl, rpcUrl } = STELLAR_NETWORK;

/** Default starting balance for a parent-created family account (XLM). The
 *  testnet base reserve (~1 XLM) is LOCKED and unspendable, so a 1 XLM account
 *  can't pay a single transaction fee. 3 XLM leaves ~2 XLM of real headroom for
 *  the kid to pay gas across claim + receive/split/collect. */
export const DEFAULT_STARTING_XLM = 3;

/** 1 XLM = 10^7 stroops. */
const XLM_STROOPS = 10_000_000n;

/**
 * localStorage set of addresses THIS device has already created/funded, so a
 * re-render or a repeated board poll never fires a second createAccount for the
 * same kid. Existence is still re-checked on-chain before every send (the store
 * is a fast-path, not the source of truth), so a cleared cache is harmless.
 */
const FUNDED_ADDRS_KEY = "maestro.funded-addresses.v1";

function loadFundedAddrs(): Set<string> {
  try {
    const raw = localStorage.getItem(FUNDED_ADDRS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function rememberFunded(addr: string): void {
  try {
    const set = loadFundedAddrs();
    set.add(addr);
    localStorage.setItem(FUNDED_ADDRS_KEY, JSON.stringify([...set]));
  } catch {
    /* non-fatal — we'll just re-check on-chain next time */
  }
}

/** Has this device already brought `addr` into existence (per the local cache)? */
export function alreadyFunded(addr: string): boolean {
  return loadFundedAddrs().has(addr.trim());
}

/** In-flight createAccount promises, keyed by destination, so two callers that
 *  race to fund the same kid (e.g. a board merge and a paste) coalesce onto one
 *  transaction instead of both submitting and one hitting op_already_exists. */
const inflight = new Map<string, Promise<EnsureResult>>();

/**
 * Does this Stellar account exist on-chain? A brand-new, unfunded account 404s
 * on Horizon — that's a definitive "no", not an error. Any other failure
 * (network blip) is rethrown so callers don't mistake a hiccup for absence.
 */
export async function accountExists(pubkey: string): Promise<boolean> {
  const horizon = new Horizon.Server(horizonUrl);
  try {
    await horizon.loadAccount(pubkey.trim());
    return true;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return false;
    throw err;
  }
}

export type EnsureResult =
  /** The account already existed — nothing was sent. */
  | { kind: "exists" }
  /** We created + funded it. `hash` is the createAccount tx hash. */
  | { kind: "created"; hash: string }
  /** A transient failure (network/RPC) — retry later; nothing landed. */
  | { kind: "error"; transient: true; detail: string }
  /** A deterministic failure (e.g. bank underfunded) — retrying won't help. */
  | { kind: "error"; transient: false; detail: string };

export interface EnsureAccountParams {
  /** The parent's in-app Keypair (the funder — holds the family XLM). */
  from: Keypair;
  /** Destination G-address to bring into existence. */
  to: string;
  /** Starting balance in XLM (default 1). */
  startingXlm?: number;
}

/**
 * Ensure `to` exists on-chain, creating + funding it from `from` if it doesn't.
 *
 * Semantics:
 *   • `to` already exists            → { kind: "exists" }  (idempotent no-op)
 *   • `to` is `from`                 → { kind: "exists" }  (the funder is itself)
 *   • `to` missing, create succeeds  → { kind: "created", hash }
 *   • funder itself doesn't exist    → { kind: "error", transient:false }
 *     (the parent bank isn't funded yet — a real precondition, not a blip)
 *   • network/RPC blip on submit     → { kind: "error", transient:true }
 *
 * Never throws — always resolves an EnsureResult so callers can branch on it and
 * surface honest UI. The tx is a classic Stellar `createAccount`, signed with the
 * funder's key and submitted via the Soroban RPC server (the app's submit path).
 */
export async function ensureAccountFunded(
  params: EnsureAccountParams,
): Promise<EnsureResult> {
  const to = params.to.trim();
  const fromPub = params.from.publicKey();

  // Nothing to do for the funder's own account, or an empty/self target.
  if (!to || to === fromPub) return { kind: "exists" };

  // Fast-path: we already funded it this session/device → assume it's live
  // (existence is confirmed below only when we're actually about to send).
  if (alreadyFunded(to)) return { kind: "exists" };

  // Coalesce concurrent callers onto a single in-flight creation.
  const pending = inflight.get(to);
  if (pending) return pending;

  const run = (async (): Promise<EnsureResult> => {
    try {
      // Already on-chain? Then we're done — record it so we skip the check next
      // time and return the idempotent no-op.
      if (await accountExists(to)) {
        rememberFunded(to);
        return { kind: "exists" };
      }

      const server = new StellarRpc.Server(rpcUrl);

      // Load the funder's account to source a valid sequence number. If THIS
      // 404s the parent bank itself isn't funded — a deterministic precondition
      // the caller must resolve (top up the bank), not a transient blip.
      let source: Account;
      try {
        source = await server.getAccount(fromPub);
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        const code = (err as { code?: number })?.code;
        if (status === 404 || code === 404) {
          return {
            kind: "error",
            transient: false,
            detail: "funder account does not exist (family bank not funded yet)",
          };
        }
        throw err;
      }

      const startingXlm = params.startingXlm ?? DEFAULT_STARTING_XLM;
      const startingBalance = xlmAmountString(startingXlm);

      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.createAccount({ destination: to, startingBalance }),
        )
        .setTimeout(60)
        .build();

      tx.sign(params.from);

      const sendResp = await server.sendTransaction(tx);
      if (sendResp.status === "ERROR") {
        // Submission rejected outright. Classify from the error XDR/text so a
        // genuine blip stays retriable and a real reject (underfunded, already
        // exists) is reported honestly.
        const detail = JSON.stringify(sendResp.errorResult ?? sendResp) || "send error";
        // An account that got created out from under us is a success, not a fail.
        if (detail.includes("op_already_exists") || detail.includes("account_merge")) {
          rememberFunded(to);
          return { kind: "exists" };
        }
        const { transient } = classifyTxError(detail, "fund");
        return { kind: "error", transient, detail };
      }

      // Poll to confirmation (classic ops confirm in a ledger or two).
      const hash = sendResp.hash;
      let getResp = await server.getTransaction(hash);
      const deadline = Date.now() + 30_000;
      while (
        getResp.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND &&
        Date.now() < deadline
      ) {
        await sleep(1000);
        getResp = await server.getTransaction(hash);
      }

      if (getResp.status === StellarRpc.Api.GetTransactionStatus.SUCCESS) {
        rememberFunded(to);
        return { kind: "created", hash };
      }
      if (getResp.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND) {
        // Still pending past the deadline — the account may yet appear. Treat as
        // transient so a caller can retry; a duplicate create later no-ops.
        return { kind: "error", transient: true, detail: "createAccount still pending" };
      }
      // FAILED — surface the result for a breadcrumb; classify for retriability.
      const detail = JSON.stringify(getResp) || "createAccount failed";
      const { transient } = classifyTxError(detail, "fund");
      return { kind: "error", transient, detail };
    } catch (err) {
      const { transient, detail } = classifyTxError(err, "fund");
      return { kind: "error", transient, detail };
    } finally {
      inflight.delete(to);
    }
  })();

  inflight.set(to, run);
  return run;
}

/** Format an XLM number as a Horizon/`createAccount` amount string (7 dp, no
 *  float drift). `1` → "1.0000000". */
function xlmAmountString(xlm: number): string {
  const stroops = BigInt(Math.round(xlm * Number(XLM_STROOPS)));
  const whole = stroops / XLM_STROOPS;
  const frac = (stroops % XLM_STROOPS).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
