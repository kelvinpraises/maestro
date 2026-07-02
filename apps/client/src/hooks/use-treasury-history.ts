// use-treasury-history.ts — the family-treasury activity feed behind the History
// screen. It fuses two sources so the list is both complete AND resilient:
//
//   1. On-chain events (Soroban RPC `getEvents` over the `zwerc20` contract):
//      "Reward funded" (deposit) and "Reward claimed · to G…/C…" (claim),
//      covering activity from every device — but only within the RPC's
//      retention window (~last few days of ledgers).
//   2. This device's LOCAL claim notes (via `useMyRewards`): the rewards this
//      wallet funded, plus their on-chain "claimed?" status. These are always
//      shown, so the user's own activity survives even after retention rolls
//      past the original deposit.
//
// The two are merged and de-duplicated (a local funded note and its on-chain
// deposit share a leaf index; a local claimed note and its on-chain claim share
// a nullifier), then sorted newest-first.

import { useQuery } from "@tanstack/react-query";
import { useMyRewards, type RewardView } from "@/hooks/use-rewards";
import {
  fetchTreasuryEvents,
  type TreasuryEvent,
} from "@/lib/treasury-events";
import { deriveNote } from "@/lib/claims";

export type HistoryKind = "funded" | "claimed";

/** One row in the activity feed, source-agnostic. */
export interface HistoryItem {
  id: string;
  kind: HistoryKind;
  /** Reward size as a display XLM number. */
  amountXlm: number;
  /** Unix ms for ordering + relative-time display. */
  timestamp: number;
  /** claimed rows only: recipient Stellar address (G…/C…). */
  to?: string;
  /** True when this row came from this device's own notes (vs pure on-chain). */
  mine: boolean;
}

export interface TreasuryHistory {
  items: HistoryItem[];
  /** True when the on-chain window was unreachable or partial — show a note. */
  truncated: boolean;
  isLoading: boolean;
}

/** Hex nullifier id (matches ClaimNote.id) for a note, to dedupe against claims. */
function nullifierIdOf(note: RewardView): string {
  const derived = deriveNote(BigInt(note.secret), BigInt(note.amountStroops));
  return "0x" + derived.nullifier.toString(16).padStart(64, "0");
}

/**
 * Build the merged, newest-first activity feed. Local notes take precedence over
 * their on-chain twins (same leaf index for deposits, same nullifier for claims)
 * so we never render a reward twice.
 */
function merge(
  events: TreasuryEvent[],
  notes: RewardView[],
): HistoryItem[] {
  const items: HistoryItem[] = [];

  // Local notes → funded rows (always) + claimed rows (when spent on-chain).
  const localLeafIndexes = new Set<number>();
  const localNullifierIds = new Set<string>();
  for (const n of notes) {
    localLeafIndexes.add(n.leafIndex);
    const nid = nullifierIdOf(n);
    items.push({
      id: `note-funded-${n.id}`,
      kind: "funded",
      amountXlm: n.amountXlm,
      timestamp: n.createdAt,
      mine: true,
    });
    if (n.claimed) {
      localNullifierIds.add(nid);
      items.push({
        id: `note-claimed-${n.id}`,
        kind: "claimed",
        amountXlm: n.amountXlm,
        // We don't persist the claim time locally, so approximate with the
        // funded time — still newest-relative and stable across reloads.
        timestamp: n.createdAt,
        mine: true,
      });
    }
  }

  // On-chain events → rows for anything NOT already covered by a local note.
  for (const ev of events) {
    if (ev.kind === "deposit") {
      if (ev.leafIndex !== undefined && localLeafIndexes.has(ev.leafIndex)) continue;
      items.push({
        id: `chain-${ev.id}`,
        kind: "funded",
        amountXlm: ev.amountXlm,
        timestamp: ev.timestamp,
        mine: false,
      });
    } else {
      // claim: dedupe against local claimed notes by nullifier id.
      if (ev.nullifierId && localNullifierIds.has(ev.nullifierId)) continue;
      items.push({
        id: `chain-${ev.id}`,
        kind: "claimed",
        amountXlm: ev.amountXlm,
        timestamp: ev.timestamp,
        to: ev.to,
        mine: false,
      });
    }
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return items;
}

/**
 * The History screen's data hook. Reads on-chain treasury events (retention-
 * bounded) and merges this device's local reward notes on top so the user's own
 * activity is always visible. Refetches the on-chain side periodically.
 */
export function useTreasuryHistory(): TreasuryHistory {
  const rewards = useMyRewards();
  const notes = rewards.data ?? [];

  const chain = useQuery({
    queryKey: ["treasury-events"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: () => fetchTreasuryEvents(),
  });

  const items = merge(chain.data?.events ?? [], notes);

  return {
    items,
    truncated: chain.data?.truncated ?? false,
    isLoading: chain.isLoading || rewards.isLoading,
  };
}
