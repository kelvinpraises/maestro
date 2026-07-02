// Configured Soroban contract clients for Maestro.
//
// Each generated bindings package (`drips`, `zwerc20`, `verifier`, `yield`)
// exports a `Client` class and a `networks` constant. We construct each client
// against Stellar testnet using the shared RPC URL + network passphrase and the
// contract ID from our own config module (kept as the single source of truth).
//
// Read-only calls (simulations) need no signer. For contract write calls, build
// a client with a signer via `withSigner(...)`, passing the in-app wallet's
// `signTransaction` + `publicKey` (see `stellar-wallet-provider`).

import { Client as ZwErc20Client } from "zwerc20";
import { Client as DripsClient } from "drips";
import { Client as VerifierClient } from "verifier";
import { Client as YieldClient } from "yield";
import { STELLAR_NETWORK, CONTRACT_IDS } from "@/config/stellar";

const baseOptions = {
  rpcUrl: STELLAR_NETWORK.rpcUrl,
  networkPassphrase: STELLAR_NETWORK.networkPassphrase,
} as const;

// Read-only client instances (no signer). Safe for simulate/`next_index`-style
// reads that never touch the ledger.
export const zwerc20 = new ZwErc20Client({
  ...baseOptions,
  contractId: CONTRACT_IDS.zwerc20,
});

export const drips = new DripsClient({
  ...baseOptions,
  contractId: CONTRACT_IDS.drips,
});

export const verifier = new VerifierClient({
  ...baseOptions,
  contractId: CONTRACT_IDS.verifier,
});

export const yieldVault = new YieldClient({
  ...baseOptions,
  contractId: CONTRACT_IDS.yield,
});

// A signer bundle as produced by the in-app wallet provider.
export interface WalletSigner {
  publicKey: string;
  signTransaction: NonNullable<
    ConstructorParameters<typeof ZwErc20Client>[0]["signTransaction"]
  >;
}

/**
 * Build write-capable clients bound to the in-app wallet. Use these for calls
 * that change contract state (deposits, claims, streams) — they carry the
 * source account + signer so `signAndSend()` works.
 */
export function withSigner(signer: WalletSigner) {
  const opts = { ...baseOptions, ...signer } as const;
  return {
    zwerc20: new ZwErc20Client({ ...opts, contractId: CONTRACT_IDS.zwerc20 }),
    drips: new DripsClient({ ...opts, contractId: CONTRACT_IDS.drips }),
    verifier: new VerifierClient({ ...opts, contractId: CONTRACT_IDS.verifier }),
    yieldVault: new YieldClient({ ...opts, contractId: CONTRACT_IDS.yield }),
  };
}
