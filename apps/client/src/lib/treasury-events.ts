// treasury-events.ts — read the family treasury's on-chain activity feed from
// Soroban RPC. The `zwerc20` contract publishes two events (see
// contracts/zwerc20/src/lib.rs):
//
//   • DepositEvent — topic ("deposit",), data { index, commitment, new_root,
//     amount } — a parent funded a private reward.
//   • ClaimEvent   — topic ("claim",),   data { nullifier, to, amount } — a kid
//     claimed a reward privately (real XLM paid to `to`).
//
// This module is pure (React-free) so the same code runs in the browser AND in
// a node verification script. It talks to `rpc.Server.getEvents` directly with
// the treasury contract-id filter and the two topic symbols.
//
// RETENTION: testnet RPC only keeps events for a limited window of recent
// ledgers (it reports `oldestLedger`, roughly the last few days). We query the
// latest ledger, clamp `startLedger` to that retention floor, and paginate
// forward with the returned cursor. If the RPC is unreachable or the window has
// rolled past our data, callers degrade to whatever the device's local claim
// notes provide (see the history screen). We never throw on a partial/empty
// result — we surface `truncated` so the UI can show a friendly note.

import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { STELLAR_NETWORK, CONTRACT_IDS } from "@/config/stellar";
import { stroopsToXlm } from "@/lib/allowance";
import { withRetry } from "@/lib/claims";

/** Topic symbols the treasury tags its two events with. */
export const DEPOSIT_TOPIC = "deposit";
export const CLAIM_TOPIC = "claim";

/**
 * How far back (in ledgers) to try to read. Testnet keeps ~120k ledgers of
 * events (~a week at ~5s/ledger); we clamp to the RPC's reported floor anyway,
 * so this is just an upper bound on how much history we walk.
 */
export const EVENT_LOOKBACK_LEDGERS = 120_000;

/** Max events pulled per `getEvents` page (RPC caps at 200). */
const PAGE_LIMIT = 200;

/**
 * Safety cap on pagination round-trips. getEvents scans only a bounded span of
 * ledgers per call, so covering the full retained window over sparse matches can
 * take many (empty) pages — hence the generous cap.
 */
const MAX_PAGES = 120;

export type TreasuryEventKind = "deposit" | "claim";

/** One decoded treasury event, normalized for the activity feed. */
export interface TreasuryEvent {
  /** Stable RPC event id (also handy as a React key). */
  id: string;
  kind: TreasuryEventKind;
  /** Ledger this event closed in. */
  ledger: number;
  /** Unix ms the event's ledger closed (for ordering + display). */
  timestamp: number;
  /** Reward size in stroops (i128 base unit). */
  amountStroops: bigint;
  /** Reward size as a display XLM number. */
  amountXlm: number;
  /** deposit: the leaf index the commitment landed at. */
  leafIndex?: number;
  /** claim: the Stellar address (G…/C…) the reward was paid to. */
  to?: string;
  /**
   * claim: the burned nullifier as a `0x…` hex id — identical to a local note's
   * `id`, so the history feed can de-dupe an on-chain claim against this
   * device's own claimed note.
   */
  nullifierId?: string;
}

export interface TreasuryEventsResult {
  events: TreasuryEvent[];
  /**
   * True when we could NOT read the full retained window — the RPC was
   * unreachable, or older events have already rolled past retention. The UI
   * pairs this with local notes and shows a "history may be partial" note.
   */
  truncated: boolean;
  /** Oldest ledger the RPC still retains, when known (for diagnostics). */
  oldestLedger?: number;
  /** Latest ledger at query time, when known. */
  latestLedger?: number;
}

/** Minimal shape of the RPC server this module needs (browser + node). */
export interface EventsRpc {
  getLatestLedger: () => Promise<{ sequence: number }>;
  getEvents: (req: rpc.Server.GetEventsRequest) => Promise<rpc.Api.GetEventsResponse>;
}

/** Default read-only RPC server (no signer needed for `getEvents`). */
export function makeEventsRpc(): EventsRpc {
  return new rpc.Server(STELLAR_NETWORK.rpcUrl);
}

/**
 * Decode a single raw `getEvents` response entry into a `TreasuryEvent`, or
 * `null` if the topic isn't one we recognize. `scValToNative` turns the topic
 * symbol into a string and the event struct into a plain object whose U256
 * fields arrive as bigint and whose `to` Address arrives as a G…/C… string.
 */
function decodeEvent(e: rpc.Api.EventResponse): TreasuryEvent | null {
  let topic: unknown;
  try {
    topic = scValToNative(e.topic[0]);
  } catch {
    return null;
  }
  if (topic !== DEPOSIT_TOPIC && topic !== CLAIM_TOPIC) return null;

  let data: Record<string, unknown>;
  try {
    data = scValToNative(e.value) as Record<string, unknown>;
  } catch {
    return null;
  }

  const amountStroops = BigInt((data.amount as bigint | number | string) ?? 0);
  const timestamp = Date.parse(e.ledgerClosedAt);

  const base = {
    id: e.id,
    ledger: e.ledger,
    timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
    amountStroops,
    amountXlm: stroopsToXlm(amountStroops),
  };

  if (topic === DEPOSIT_TOPIC) {
    return { ...base, kind: "deposit", leafIndex: Number(data.index ?? 0) };
  }
  const nullifier = BigInt((data.nullifier as bigint | number | string) ?? 0);
  return {
    ...base,
    kind: "claim",
    to: String(data.to ?? ""),
    nullifierId: "0x" + nullifier.toString(16).padStart(64, "0"),
  };
}

/**
 * Fetch the treasury's deposit + claim events from Soroban RPC, newest first.
 *
 * Strategy:
 *   1. Read the latest ledger; clamp `startLedger` to the retention floor
 *      (`latest - EVENT_LOOKBACK_LEDGERS`, further clamped to the RPC's own
 *      `oldestLedger` if a first page reports one).
 *   2. Page forward with the RPC cursor until events run dry or we hit the page
 *      cap. Each network read is retried with backoff (flaky connectivity).
 *   3. Decode + sort newest-first. On ANY failure return whatever we have with
 *      `truncated: true` — never throw. The caller merges local notes on top.
 */
export async function fetchTreasuryEvents(
  server: EventsRpc = makeEventsRpc(),
  contractId: string = CONTRACT_IDS.zwerc20,
): Promise<TreasuryEventsResult> {
  const out: TreasuryEvent[] = [];
  let truncated = false;
  let oldestLedger: number | undefined;
  let latestLedger: number | undefined;

  try {
    const latest = (await withRetry(() => server.getLatestLedger())).sequence;
    latestLedger = latest;
    let startLedger = Math.max(1, latest - EVENT_LOOKBACK_LEDGERS);

    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const req = (
        cursor
          ? { filters: [{ type: "contract", contractIds: [contractId] }], cursor, limit: PAGE_LIMIT }
          : { filters: [{ type: "contract", contractIds: [contractId] }], startLedger, limit: PAGE_LIMIT }
      ) as rpc.Server.GetEventsRequest;

      let res: rpc.Api.GetEventsResponse;
      try {
        res = await withRetry(() => server.getEvents(req));
      } catch (err) {
        // Most commonly: `startLedger must be within the ledger range …` when
        // our clamp under-shot the retention floor. Re-clamp to the RPC's
        // reported floor (parsed from the error) once, then bail gracefully.
        const floor = parseRetentionFloor(err);
        if (!cursor && floor && floor > startLedger) {
          startLedger = floor;
          oldestLedger = floor;
          page--; // retry this page with the corrected start
          continue;
        }
        truncated = true;
        break;
      }

      if (typeof res.oldestLedger === "number") oldestLedger = res.oldestLedger;

      for (const raw of res.events) {
        const ev = decodeEvent(raw);
        if (ev) out.push(ev);
      }

      // getEvents scans only a bounded span of ledgers per call and hands back a
      // cursor to continue — even when a page is EMPTY (sparse matches far from
      // `startLedger`). So we drive pagination off the cursor, not page length:
      // keep walking while the cursor advances toward the tip. We stop when the
      // cursor stalls (no forward progress) or its ledger reaches `latest`.
      if (!res.cursor || res.cursor === cursor) break;
      cursor = res.cursor;
      if (cursorLedger(cursor) >= latest) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }

    // If the RPC's oldest retained ledger is newer than our intended start, some
    // earlier history is unreachable — flag it so the UI can say so.
    if (oldestLedger && oldestLedger > Math.max(1, latest - EVENT_LOOKBACK_LEDGERS)) {
      truncated = true;
    }
  } catch {
    // RPC unreachable entirely (offline). Degrade to an empty on-chain list;
    // the caller still shows local notes.
    truncated = true;
  }

  out.sort((a, b) => b.timestamp - a.timestamp || b.ledger - a.ledger);
  return { events: out, truncated, oldestLedger, latestLedger };
}

/** Pull the lower bound out of an RPC "ledger range: N - M" error, if present. */
function parseRetentionFloor(err: unknown): number | undefined {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/ledger range:\s*(\d+)\s*-/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Ledger sequence encoded in a getEvents cursor. The cursor is a toid string
 * `"<id>-<opIndex>"` whose `id` high 32 bits are the ledger sequence. Used to
 * detect when pagination has walked up to the latest ledger.
 */
function cursorLedger(cursor: string): number {
  try {
    const id = BigInt(cursor.split("-")[0]);
    return Number(id >> 32n);
  } catch {
    return 0;
  }
}
