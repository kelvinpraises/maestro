// Stellar (Soroban) testnet configuration for Maestro.
//
// This module stands alone alongside the legacy EVM config (`chains.ts`). It
// holds the network settings and the on-chain contract IDs for the four freshly
// deployed Soroban contracts backing the family treasury, plus the native-XLM
// asset (SAC) contract used as the treasury's underlying asset.
//
// All IDs are baked from `deployments.testnet.env` at the repo root.

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
