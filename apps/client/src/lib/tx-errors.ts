// tx-errors.ts — one honest place that decides whether a money-transaction
// failure is TRANSIENT (a network/RPC/ledger blip — retrying can win) or
// DETERMINISTIC (the ledger truthfully rejected this call — retrying is a lie),
// and turns either into kid-safe copy.
//
// Why this exists (the bug this fixes): every money catch site used to show the
// SAME line — "The bank line is busy … try again in a moment." — for ANY error.
// That copy is only TRUE for a network drop (DESIGN-STORY Story D). Shown for a
// deterministic reject (reward already claimed, not enough in the bank, proof
// rejected) it tells the kid to "try again" at something that will never work —
// exactly the "money states never lie" rule Story D forbids. And because the
// underlying error was swallowed, a genuine blip got no real retry either.
//
// The classifier keys on the ERROR MESSAGE, not its class. The Soroban SDK's
// error subclasses are transpiled such that `error.name` collapses to "Error"
// (verified against @stellar/stellar-sdk), so the stable signal is the message
// text the SDK throws (e.g. `Transaction simulation failed: "HostError …"`).
//
// React-free on purpose: the hooks import it, and it stays testable in node.

export type MoneyOp = "claim" | "collect" | "fund";

export interface ClassifiedTxError {
  /** True → a retry could plausibly succeed (network/RPC/ledger congestion). */
  transient: boolean;
  /** Kid-safe, truthful one-liner for the failure card. Never a hex string. */
  kidMessage: string;
  /** The raw message (trimmed), for console breadcrumbs — never shown to a kid. */
  detail: string;
}

/** Pull a lowercase message out of anything throwable. */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ── signals ──────────────────────────────────────────────────────────────────
// Substrings that mark a failure as a genuine network/RPC/ledger blip. These are
// the ONLY cases where "try again in a moment" is a true statement.
const TRANSIENT_SIGNALS = [
  "failed to fetch", // browser fetch abort / connection reset
  "fetch failed", // node undici
  "networkerror",
  "network error",
  "err_network",
  "err_connection",
  "err_timed_out",
  "timeout",
  "timed out",
  "etimedout",
  "econnreset",
  "econnrefused",
  "enotfound", // DNS hiccup (this machine's flaky resolver)
  "eai_again",
  "socket hang up",
  "load failed", // Safari fetch failure text
  "try_again_later", // Soroban sendTransaction congestion status
  "try again later",
  "sending the transaction to the network failed", // SDK SendFailed (submit RPC failed)
  "attempting to send the transaction failed",
  "waited", // SDK TransactionStillPending ("Waited N seconds …")
  "status 429", // rate limited
  "status 502",
  "status 503",
  "status 504",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "rpc",
  "getaddrinfo",
];

// A HostError code that means "the ledger considered this and said no". The
// zwerc20 double-claim reject surfaces as WasmVm/InvalidAction; a light budget
// or a bad proof surface as other HostError codes. All are deterministic.
const DETERMINISTIC_SIGNALS = [
  "transaction simulation failed", // SDK SimulationFailed — the ledger rejected it
  "you need to restore some contract state", // SDK ExpiredState
  "restore", // RestorationFailure
  "hosterror", // any Soroban host error that reached us
  "invalidaction",
  "existingvalue", // storage already-set (e.g. nullifier consumed)
  "insufficient", // not enough balance in the bank / vault
  "trustline",
  "unauthorized",
  "user rejected", // an in-wallet decline is not going to un-happen on its own
  "user declined",
];

/** Does `msg` contain any of `signals`? */
function hasAny(msg: string, signals: string[]): boolean {
  return signals.some((s) => msg.includes(s));
}

// ── kid-safe copy ─────────────────────────────────────────────────────────────
// Per DESIGN-STORY Story D: never a stack trace, never a hex string. The
// transient line is the sanctioned "bank line is busy … {noun} is safe, try
// again in a moment." The deterministic lines tell the truth kindly instead of
// promising a retry that can't win.

const SAFE_NOUN: Record<MoneyOp, string> = {
  claim: "Your reward is safe",
  collect: "Your money is safe",
  fund: "Nothing was sent",
};

function transientCopy(op: MoneyOp): string {
  return `The bank line is busy. ${SAFE_NOUN[op]}, try again in a moment.`;
}

/** Truthful, kid-safe copy for a deterministic reject, tuned per money op. */
function deterministicCopy(op: MoneyOp, msg: string): string {
  // Reward already claimed (double-tap, or claimed on another device).
  if (
    op === "claim" &&
    (hasAny(msg, ["invalidaction", "existingvalue"]) ||
      msg.includes("nullifier"))
  ) {
    return "This reward has already been claimed. It's safely in a stash.";
  }
  // Not enough money in the pot to cover this.
  if (hasAny(msg, ["insufficient"])) {
    if (op === "fund") return "The family bank needs a top-up to send this reward.";
    return "There isn't enough in the bank for this just yet.";
  }
  // Everything else deterministic: honest, no retry promise, no hex.
  if (op === "claim") return "This reward couldn't be claimed right now. Ask a grown-up to check it.";
  if (op === "collect") return "This didn't go through. Ask a grown-up to take a look.";
  return "This didn't go through. Check the family bank and try again.";
}

/**
 * Classify a caught money-transaction error and produce kid-safe copy.
 *
 * Order matters: a deterministic ledger reject can travel over the network, so a
 * message that names a HostError / simulation failure is deterministic EVEN IF it
 * also mentions "rpc". We therefore test the deterministic signals first, and
 * only fall through to transient for pure network/plumbing failures. When the
 * message is unrecognizable we default to TRANSIENT — the safer bias for the
 * kid (offer a retry) and it can never silently mark a real reward as gone.
 */
export function classifyTxError(err: unknown, op: MoneyOp): ClassifiedTxError {
  const raw = messageOf(err).trim();
  const msg = raw.toLowerCase();

  if (hasAny(msg, DETERMINISTIC_SIGNALS)) {
    return { transient: false, kidMessage: deterministicCopy(op, msg), detail: raw };
  }
  if (hasAny(msg, TRANSIENT_SIGNALS)) {
    return { transient: true, kidMessage: transientCopy(op), detail: raw };
  }
  // Unknown → treat as transient (Story D: "if we don't know, we say checking…"
  // — offer the retry rather than declaring the reward unclaimable).
  return { transient: true, kidMessage: transientCopy(op), detail: raw };
}

/**
 * Retry a submit that can fail transiently, with linear backoff. A DETERMINISTIC
 * failure (the ledger truthfully said no) is re-thrown IMMEDIATELY — retrying it
 * would just relay the same reject and waste the kid's time. Only transient blips
 * get another turn.
 *
 * This is the counterpart to lib/claims.withRetry (which guards read-only RPC
 * pagination). It carries the SAME crypto/tx call verbatim — no semantics change,
 * just a bounded re-attempt on network/ledger congestion.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  op: MoneyOp,
  attempts = 3,
  baseMs = 900,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const { transient } = classifyTxError(err, op);
      // Deterministic reject, or out of attempts → give up now, surface truth.
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseMs * (i + 1)));
    }
  }
  throw lastErr;
}
