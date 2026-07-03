// Stellar (Soroban) testnet configuration for Maestro.
//
// This module stands alone alongside the legacy EVM config (`chains.ts`). It
// holds the network settings and the on-chain contract IDs for the four freshly
// deployed Soroban contracts backing the family treasury, plus the native-XLM
// asset (SAC) contract used as the treasury's underlying asset.
//
// All IDs are baked from `apps/contracts/deployments.testnet.env`.

import { Keypair, contract as StellarContract } from "@stellar/stellar-sdk";

export const STELLAR_NETWORK = {
  /** Soroban RPC endpoint (read/simulate + submit). */
  rpcUrl: "https://soroban-testnet.stellar.org",
  /** Horizon endpoint (account/balance lookups). */
  horizonUrl: "https://horizon-testnet.stellar.org",
  /** Friendbot — funds new testnet accounts with XLM (can be flaky). */
  friendbotUrl: "https://friendbot.stellar.org",
  /** Network passphrase for signing + client construction. */
  networkPassphrase: "Test SDF Network ; September 2015",
} as const;

// Deployed Soroban contract IDs (Stellar testnet).
export const CONTRACT_IDS = {
  /** Groth16 proof verifier. */
  verifier: "CAYENB4W7ALZPIPLAUPR64OSF47H52I5YL2QNKS5UUGRB65MNZBR7ZZE",
  /** Shielded treasury / private-claim ledger. */
  zwerc20: "CB4NCPRKEW4PQVCE74SGS42OAEMV75ULJTYHHZDC5UOVXGOBEAJF6PJH",
  /** Allowance streaming ("drips"). */
  drips: "CBKYQ357VMHM4RVM6QK2UO324RSM75DD66LGFAOCDGJZCOWSERSEKHVH",
  /** Yield vault — grows the family stash. */
  yield: "CAQKJBXQRRF4EUQWUZWHO2YBNUED6H5L5HTHAUZKBDZ2MCQTAF4DV2FB",
  /** Native XLM asset contract (SAC) — the treasury's underlying asset. */
  underlying: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
} as const;

// ── Relayer (the anonymity set for private reward claims) ────────────────────
//
// The privacy fix (context/TWO-WALLET-PRIVACY.md): a kid holds TWO keypairs — a
// public `spending` wallet (allowance) and a private `stash` (reward claims) —
// and this shared, neutral RELAYER account submits every `remint(to = stash)`.
// `zwerc20::remint` has NO `require_auth`, so any account may submit it; the
// payout is bound by the zk proof and cannot be redirected. So the relayer only
// ever pays gas + forwards an unstealable, proof-bound payout. On-chain every
// claim across every family is sourced from this one account → a shared
// anonymity set, and the recipient stash (a fresh address the relayer paid) is
// unlinkable to any kid.
//
// Testnet, demo-grade: created + funded (100 XLM) by the lead, NO admin powers.
// Safe to embed in the client for the demo — if the key leaks it can only pay
// gas / submit valid proofs (payout is proof-bound). Production runs the relayer
// as a server-side service (apps/server) so the key isn't shipped; that is a
// noted residual, out of scope for the demo.
export const RELAYER = {
  publicKey: "GAOICFNJH6G2SYL6EZHWWA2U2DOOJBHBJXQEXGWCI2RGOX2MLMB7CUOK",
  secret: "SB67SH2MNEBNNGKOAINQ6FOI76BRFELVOSFKFBIRJ7PHOPDPWBSAGYVQ",
} as const;

/** The relayer's Keypair (funder for stash base reserves; classic tx signer). */
export function relayerKeypair(): Keypair {
  return Keypair.fromSecret(RELAYER.secret);
}

/**
 * Build the relayer's `signTransaction` for Soroban contract writes, mirroring
 * how the wallet provider builds `basicNodeSigner`. Pair with
 * `withSigner({ publicKey: RELAYER.publicKey, signTransaction: relayerSign() })`
 * to submit a `remint` sourced + signed by the relayer.
 */
export function relayerSign() {
  return StellarContract.basicNodeSigner(
    relayerKeypair(),
    STELLAR_NETWORK.networkPassphrase,
  ).signTransaction;
}
