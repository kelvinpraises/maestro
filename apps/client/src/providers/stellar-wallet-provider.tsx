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

const SECRET_STORAGE_KEY = "maestro.stellar.secret";

const { networkPassphrase, horizonUrl, rpcUrl, friendbotUrl } = STELLAR_NETWORK;

// SignTransaction wired from the local keypair, for contract write calls.
type SignTransaction = ReturnType<
  typeof StellarContract.basicNodeSigner
>["signTransaction"];

interface StellarWalletContextValue {
  /** Ready once the keypair has been loaded/generated from localStorage. */
  isReady: boolean;
  publicKey: string;
  keypair: Keypair;
  /** Signs a transaction XDR with the in-app key (for contract write calls). */
  signTransaction: SignTransaction;
  /** XLM balance as a display string, or null while unknown / account missing. */
  xlmBalance: string | null;
  /** True once we've completed at least one balance lookup. */
  balanceLoaded: boolean;
  /** Re-read the XLM balance from testnet on demand. */
  refreshBalance: () => Promise<void>;
  /** Fund this wallet via friendbot. Resolves false on failure (retriable). */
  fund: () => Promise<boolean>;
  isFunding: boolean;
}

const StellarWalletContext = createContext<StellarWalletContextValue | null>(
  null
);

function loadOrCreateKeypair(): Keypair {
  try {
    const stored = localStorage.getItem(SECRET_STORAGE_KEY);
    if (stored) return Keypair.fromSecret(stored);
  } catch {
    // localStorage unavailable or corrupt secret — fall through and mint a new one.
  }
  const kp = Keypair.random();
  try {
    localStorage.setItem(SECRET_STORAGE_KEY, kp.secret());
  } catch {
    // Non-fatal: wallet still works this session, just won't persist.
  }
  return kp;
}

export function StellarWalletProvider({ children }: { children: ReactNode }) {
  // Keypair is generated once, synchronously, so downstream contract clients
  // always have a signer available.
  const keypairRef = useRef<Keypair | null>(null);
  if (keypairRef.current === null) {
    keypairRef.current = loadOrCreateKeypair();
  }
  const keypair = keypairRef.current;
  const publicKey = keypair.publicKey();

  const signTransaction = useMemo(
    () => StellarContract.basicNodeSigner(keypair, networkPassphrase).signTransaction,
    [keypair]
  );

  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const refreshBalance = useCallback(async () => {
    try {
      const horizon = new Horizon.Server(horizonUrl);
      const account = await horizon.loadAccount(publicKey);
      const native = account.balances.find(
        (b) => b.asset_type === "native"
      );
      setXlmBalance(native ? native.balance : "0");
    } catch (err) {
      // A brand-new, unfunded account 404s on Horizon — that's a real "0", not
      // an error the user needs to see.
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 404) {
        setXlmBalance("0");
      } else {
        // Network hiccup — keep the last known value, leave a breadcrumb.
        console.warn("[stellar-wallet] balance refresh failed", err);
      }
    } finally {
      setBalanceLoaded(true);
    }
  }, [publicKey]);

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
      signTransaction,
      xlmBalance,
      balanceLoaded,
      refreshBalance,
      fund,
      isFunding,
    }),
    [
      isReady,
      publicKey,
      keypair,
      signTransaction,
      xlmBalance,
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
