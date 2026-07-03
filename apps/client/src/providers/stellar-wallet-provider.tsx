import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Keypair,
  Horizon,
  rpc as StellarRpc,
  contract as StellarContract,
} from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "@/config/stellar";

// In-app Stellar wallet for Maestro.
//
// This replaces the role Privy played in the old EVM stack: on first boot we
// generate an ed25519 keypair and persist the secret in localStorage. That is
// fine for a hackathon demo (no server, no custody) — NOT how you would store a
// key in production. A returning user gets the same wallet (and therefore the
// same family-treasury identity) back on reload.
//
// TWO-WALLET PRIVACY SPLIT (context/TWO-WALLET-PRIVACY.md). A kid device holds
// TWO ed25519 keypairs, both in localStorage:
//   • spending (public identity): receives the allowance stream, pays gas to
//     collect it, and is the only address published to the family board.
//   • stash (private): receives reward claims ONLY, via a relayer-submitted
//     remint. No transaction the kid signs ever names or touches it publicly.
// The kid sees ONE pot: totalBalance = spending + stash. On-chain they are two
// unlinked addresses. `publicKey`/`keypair` remain the SPENDING keypair for
// back-compat (board, allowance, deposits all keep working unchanged).
//
// MIGRATION: the pre-existing single secret BECOMES `spending` — it already
// holds funds/identity, so it is never regenerated. A returning user keeps their
// spending wallet and gets a freshly minted stash the first time this loads.

const SECRET_STORAGE_KEY = "maestro.stellar.secret";
const STASH_SECRET_STORAGE_KEY = "maestro.stellar.stash.secret";

const { networkPassphrase, horizonUrl, rpcUrl, friendbotUrl } = STELLAR_NETWORK;

// SignTransaction wired from the local keypair, for contract write calls.
type SignTransaction = ReturnType<
  typeof StellarContract.basicNodeSigner
>["signTransaction"];

/** A kid's private stash: receives reward claims only, never published. */
interface StashInfo {
  publicKey: string;
  keypair: Keypair;
}

interface StellarWalletContextValue {
  /** Ready once both keypairs have been loaded/generated from localStorage. */
  isReady: boolean;
  /** SPENDING public key (back-compat: the allowance recipient + board identity). */
  publicKey: string;
  /** SPENDING keypair (back-compat alias for the public identity). */
  keypair: Keypair;
  /** The private stash (reward-claim recipient). Never published to the board. */
  stash: StashInfo;
  /** Signs a transaction XDR with the SPENDING key (for contract write calls). */
  signTransaction: SignTransaction;
  /**
   * Combined balance (spending + stash) as a display string, or null while
   * unknown. Back-compat alias for `totalBalance` — the kid sees ONE pot. Every
   * balance the kid is shown is this total.
   */
  xlmBalance: string | null;
  /** Spending-wallet XLM balance (display string), or null while unknown. */
  spendingBalance: string | null;
  /** Stash XLM balance (display string), or null while unknown. */
  stashBalance: string | null;
  /** spending + stash summed (display string), or null while unknown. The pot. */
  totalBalance: string | null;
  /** True once we've completed at least one balance lookup (both wallets). */
  balanceLoaded: boolean;
  /** Re-read both XLM balances from testnet on demand. */
  refreshBalance: () => Promise<void>;
  /** Fund the SPENDING wallet via friendbot. Resolves false on failure (retriable). */
  fund: () => Promise<boolean>;
  isFunding: boolean;
}

const StellarWalletContext = createContext<StellarWalletContextValue | null>(
  null
);

/**
 * Load (or first-time mint) a keypair persisted under `storageKey`.
 *
 * Crucial for the migration: the SPENDING key reuses the pre-existing
 * `maestro.stellar.secret`, so a returning user's identity/funds are preserved —
 * this only mints when the slot is genuinely empty. The stash uses its own new
 * slot, so a returning user gets a fresh stash the first time this runs while
 * keeping their existing spending wallet untouched.
 */
function loadOrCreateKeypair(storageKey: string): Keypair {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) return Keypair.fromSecret(stored);
  } catch {
    // localStorage unavailable or corrupt secret — fall through and mint a new one.
  }
  const kp = Keypair.random();
  try {
    localStorage.setItem(storageKey, kp.secret());
  } catch {
    // Non-fatal: wallet still works this session, just won't persist.
  }
  return kp;
}

/**
 * Read one account's native XLM balance from Horizon. A brand-new, unfunded
 * account 404s — that's a real "0", not an error. Any other failure returns
 * `null` (unknown) so the caller can keep the last known value; it never throws.
 */
async function readNativeBalance(pubkey: string): Promise<string | null> {
  try {
    const horizon = new Horizon.Server(horizonUrl);
    const account = await horizon.loadAccount(pubkey);
    const native = account.balances.find((b) => b.asset_type === "native");
    return native ? native.balance : "0";
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return "0";
    console.warn("[stellar-wallet] balance read failed", err);
    return null;
  }
}

/** Sum two XLM display strings without float drift (7-dp fixed point). */
function sumXlm(a: string, b: string): string {
  const toStroops = (s: string): bigint => {
    const [whole, frac = ""] = s.split(".");
    const fracPadded = (frac + "0000000").slice(0, 7);
    return BigInt(whole || "0") * 10_000_000n + BigInt(fracPadded || "0");
  };
  const total = toStroops(a) + toStroops(b);
  const whole = total / 10_000_000n;
  const frac = (total % 10_000_000n).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

export function StellarWalletProvider({ children }: { children: ReactNode }) {
  // Both keypairs are generated once, synchronously, so downstream contract
  // clients always have a signer available. SPENDING reuses the pre-existing
  // secret (migration: identity/funds preserved); STASH is minted fresh.
  const keypairRef = useRef<Keypair | null>(null);
  if (keypairRef.current === null) {
    keypairRef.current = loadOrCreateKeypair(SECRET_STORAGE_KEY);
  }
  const keypair = keypairRef.current;
  const publicKey = keypair.publicKey();

  const stashKeypairRef = useRef<Keypair | null>(null);
  if (stashKeypairRef.current === null) {
    stashKeypairRef.current = loadOrCreateKeypair(STASH_SECRET_STORAGE_KEY);
  }
  const stashKeypair = stashKeypairRef.current;
  const stashPublicKey = stashKeypair.publicKey();

  const signTransaction = useMemo(
    () => StellarContract.basicNodeSigner(keypair, networkPassphrase).signTransaction,
    [keypair]
  );

  const stash = useMemo<StashInfo>(
    () => ({ publicKey: stashPublicKey, keypair: stashKeypair }),
    [stashPublicKey, stashKeypair]
  );

  // Spending + stash balances tracked separately; the kid is shown their sum.
  const [spendingBalance, setSpendingBalance] = useState<string | null>(null);
  const [stashBalance, setStashBalance] = useState<string | null>(null);
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const refreshBalance = useCallback(async () => {
    // Read both wallets; each read is self-contained and never throws. A null
    // (network hiccup) keeps the last known value rather than clobbering it.
    const [spend, st] = await Promise.all([
      readNativeBalance(publicKey),
      readNativeBalance(stashPublicKey),
    ]);
    if (spend !== null) setSpendingBalance(spend);
    if (st !== null) setStashBalance(st);
    setBalanceLoaded(true);
  }, [publicKey, stashPublicKey]);

  // The pot the kid sees: spending + stash as ONE number. Null until at least
  // one side is known; falls back to the known side while the other loads.
  const totalBalance = useMemo<string | null>(() => {
    if (spendingBalance === null && stashBalance === null) return null;
    return sumXlm(spendingBalance ?? "0", stashBalance ?? "0");
  }, [spendingBalance, stashBalance]);

  // Tops up the SPENDING wallet only (its allowance/gas identity). The stash is
  // never friendbot-funded here — its base reserve is created by the relayer at
  // claim time, so nothing publicly links the stash to this device.
  const fund = useCallback(async (): Promise<boolean> => {
    setIsFunding(true);
    try {
      const res = await fetch(
        `${friendbotUrl}/?addr=${encodeURIComponent(publicKey)}`
      );
      if (!res.ok) {
        // Friendbot is flaky and also 400s if the account is already funded.
        // Re-check the balance so an "already funded" case still reflects truth.
        await refreshBalance();
        return false;
      }
      await refreshBalance();
      return true;
    } catch (err) {
      console.warn("[stellar-wallet] friendbot funding failed", err);
      return false;
    } finally {
      setIsFunding(false);
    }
  }, [publicKey, refreshBalance]);

  // Initial load + light polling so the dashboard balance stays fresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshBalance();
      if (!cancelled) setIsReady(true);
    })();
    const id = setInterval(refreshBalance, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshBalance]);

  const value = useMemo<StellarWalletContextValue>(
    () => ({
      isReady,
      publicKey,
      keypair,
      stash,
      signTransaction,
      // Back-compat: `xlmBalance` is now the combined pot (spending + stash), so
      // every existing reader that displayed it shows the total the kid owns.
      xlmBalance: totalBalance,
      spendingBalance,
      stashBalance,
      totalBalance,
      balanceLoaded,
      refreshBalance,
      fund,
      isFunding,
    }),
    [
      isReady,
      publicKey,
      keypair,
      stash,
      signTransaction,
      totalBalance,
      spendingBalance,
      stashBalance,
      balanceLoaded,
      refreshBalance,
      fund,
      isFunding,
    ]
  );

  return (
    <StellarWalletContext.Provider value={value}>
      {children}
    </StellarWalletContext.Provider>
  );
}

export function useStellarWallet(): StellarWalletContextValue {
  const ctx = useContext(StellarWalletContext);
  if (!ctx) {
    throw new Error(
      "useStellarWallet must be used within a StellarWalletProvider"
    );
  }
  return ctx;
}

// Re-export for callers that want a raw RPC server for reads.
export function makeRpcServer(): StellarRpc.Server {
  return new StellarRpc.Server(rpcUrl);
}
