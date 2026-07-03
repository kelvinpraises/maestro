// use-family-board.ts — the encrypted family board sync loop.
//
// Holds this family's {boardId, familyKey} (from the family store) and this
// device's Stellar keypair (the wallet), then keeps the local stores and the
// server's single encrypted blob in agreement:
//
//   • POLL   — GET /board/:boardId every ~8s while the tab is visible, on focus,
//              and once right after any local mutation. Decrypt, verify every
//              signature, and MERGE INTO the local stores:
//                 - kid device: adopt the parent's chore list
//                 - both:       merge per-(chore,kid) states (newest `at` wins)
//                 - both:       fill the kid-addresses map from published kids
//                 - both:       cache board notices for the family feed
//   • PUSH   — after a local mutation, rebuild the board from the last-known-good
//              board plus THIS device's freshly-signed sections, encrypt, and PUT
//              version+1. On 409 (someone else wrote first) re-pull, re-merge, and
//              retry with bounded backoff.
//   • JOIN   — on a kid device with no published address yet, write
//              kids[kidName].address = my public key AND a kid-joined notice, so
//              the parent's allowance picker + family feed light up automatically.
//
// Everything degrades gracefully: no boardId/familyKey (old invite, or the board
// server is down/unreachable) → the loop no-ops and the app behaves exactly as it
// does today (links still work by hand).

import { useCallback, useEffect, useRef, useState } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import {
  BOARD_SERVER_URL,
  NOTICES_CAP,
  type Board,
  type BoardNotice,
  type Signed,
  signSection,
  verifySection,
  encryptBoard,
  decryptBoard,
  verifyBoard,
  stateKey,
} from "@/lib/board";
import {
  loadFamily,
  loadChoreStates,
  saveChoreStates,
  saveFamily,
  emitFamilyChanged,
  emitChoreStatesChanged,
  setKidAddress,
  saveBoardNotices,
  recordDone,
  randomId,
  FAMILY_EVENT,
  type Family,
  type Chore,
  type ChoreStates,
  type FeedEntry,
} from "@/lib/family";

const POLL_MS = 8_000;
/** Backoff schedule for a PUT that keeps 409-ing (bounded, then give up). */
const RETRY_BACKOFFS = [150, 400, 900];

// ─────────────────────────────────────────────────────────────────────────────
//  Server IO — a thin fetch wrapper, all failures swallowed to "offline".
// ─────────────────────────────────────────────────────────────────────────────

interface ServerRecord {
  version: number;
  blob: string;
}

async function getBoardRecord(boardId: string): Promise<ServerRecord | null> {
  try {
    const res = await fetch(`${BOARD_SERVER_URL}/board/${encodeURIComponent(boardId)}`);
    if (res.status === 404) return null; // no board yet
    if (!res.ok) return null;
    return (await res.json()) as ServerRecord;
  } catch {
    return null; // offline / server down — caller keeps local state
  }
}

/** PUT the next version. Returns "ok", "conflict" (with the current record), or
 *  "offline". A conflict means someone else wrote first — re-pull and retry. */
async function putBoardRecord(
  boardId: string,
  version: number,
  blob: string,
): Promise<
  | { kind: "ok" }
  | { kind: "conflict"; current: ServerRecord | null }
  | { kind: "offline" }
> {
  try {
    const res = await fetch(`${BOARD_SERVER_URL}/board/${encodeURIComponent(boardId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, blob }),
    });
    if (res.ok) return { kind: "ok" };
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { current?: ServerRecord | null };
      return { kind: "conflict", current: body.current ?? null };
    }
    return { kind: "offline" }; // 4xx/5xx we don't special-case → treat as transient
  } catch {
    return { kind: "offline" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Board construction — layer THIS device's signed sections onto the last board.
// ─────────────────────────────────────────────────────────────────────────────

/** A brand-new board seeded by the parent (family + chores signed now). */
function seedBoard(family: Family, keypair: Keypair): Board {
  return {
    v: 1,
    family: signSection(
      { name: family.name, parentAddress: family.parentAddress },
      keypair,
    ),
    chores: signSection(family.chores, keypair),
    kids: {},
    states: {},
    notices: [],
  };
}

/**
 * Rebuild the board to PUT: start from the last-known-good decrypted board (so we
 * preserve every OTHER device's signed sections verbatim), then overwrite only
 * the sections THIS device is authoritative for, freshly signed:
 *   • parent → family header + chore list
 *   • kid    → its own kids[kidName] presence + its own state entries
 *   • both   → append any pending notices this device authored
 */
function buildOutboundBoard(
  prev: Board | null,
  family: Family,
  keypair: Keypair,
  localStates: ChoreStates,
  pendingNotices: Signed<BoardNotice>[],
): Board {
  const base: Board = prev ?? seedBoard(family, keypair);
  const myAddr = keypair.publicKey();

  if (family.role === "parent") {
    // Parent owns the family header + the chore list.
    base.family = signSection(
      { name: family.name, parentAddress: family.parentAddress },
      keypair,
    );
    base.chores = signSection(family.chores, keypair);
  } else if (family.role === "kid" && family.kidName) {
    // Kid publishes/refreshes its own presence.
    const kidName = family.kidName;
    const existing = verifySection(base.kids[kidName], base.kids[kidName]?.signer);
    base.kids = {
      ...base.kids,
      [kidName]: signSection(
        { address: myAddr, joinedAt: existing?.joinedAt ?? Date.now() },
        keypair,
      ),
    };
    // Kid re-signs ONLY its own (chore,kid) state entries from local state.
    const nextStates = { ...base.states };
    for (const [choreId, byKid] of Object.entries(localStates)) {
      const entry = byKid[kidName];
      if (!entry) continue;
      nextStates[stateKey(choreId, kidName)] = signSection(
        { choreId, kidName, entry },
        keypair,
      );
    }
    base.states = nextStates;
  }

  // Append this device's pending notices (deduped by id, capped tail).
  if (pendingNotices.length > 0) {
    const seen = new Set(base.notices.map((n) => n.payload.id));
    const merged = [...base.notices];
    for (const n of pendingNotices) {
      if (!seen.has(n.payload.id)) {
        merged.push(n);
        seen.add(n.payload.id);
      }
    }
    base.notices = merged.slice(-NOTICES_CAP);
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Merge IN — a verified board → the local stores.
// ─────────────────────────────────────────────────────────────────────────────

/** Apply a verified board to local state. Returns true if anything changed. */
function mergeIntoLocal(board: Board, family: Family): boolean {
  const view = verifyBoard(board, family.parentAddress);
  let changed = false;

  // 1) Kid device adopts the parent's authoritative chore list.
  if (family.role === "kid" && view.chores.length >= 0) {
    if (JSON.stringify(family.chores) !== JSON.stringify(view.chores)) {
      const next: Family = { ...family, chores: view.chores as Chore[] };
      saveFamily(next);
      emitFamilyChanged();
      changed = true;
    }
  }

  // 2) Per-(chore,kid) states: adopt the board entry when it's newer (or new).
  const local = loadChoreStates();
  const nextStates: ChoreStates = structuredCloneSafe(local);
  let statesChanged = false;
  for (const [choreId, byKid] of Object.entries(view.states)) {
    for (const [kidName, entry] of Object.entries(byKid)) {
      // A kid device never overwrites its OWN entries from the board (it is the
      // author of record) — only other kids' entries flow in. The parent adopts
      // everything (it authors none).
      if (family.role === "kid" && kidName === family.kidName) continue;
      const cur = nextStates[choreId]?.[kidName];
      if (!cur || entry.at > cur.at) {
        (nextStates[choreId] ??= {})[kidName] = entry;
        statesChanged = true;
        // Feed the append-only done log so streaks stay honest across devices.
        if (entry.state === "done") recordDone(choreId, kidName, entry.at);
      }
    }
  }
  if (statesChanged) {
    saveChoreStates(nextStates);
    emitChoreStatesChanged();
    changed = true;
  }

  // 3) Fill the kid-addresses map from published kids (feeds the allowance picker).
  for (const [kidName, kid] of Object.entries(view.kids)) {
    if (kid.address) setKidAddress(kidName, kid.address); // no-ops when unchanged
  }

  // 4) Cache board notices for the family feed (attributable, warm).
  const feedRows: FeedEntry[] = view.notices.map((n) => ({
    id: n.id,
    at: n.at,
    kind: n.kind,
    ...(n.kidName ? { kidName: n.kidName } : {}),
    ...(n.text ? { text: n.text } : {}),
  }));
  saveBoardNotices(feedRows);

  return changed;
}

/** structuredClone with a JSON fallback (states are plain JSON). */
function structuredCloneSafe<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  The hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mount once (in a provider). Runs the poll + push loop for the current family.
 * Exposes `pushNow()` so mutation sites can nudge an immediate sync, and
 * `postNotice()` so flows (task #4) can drop a signed notice on the board.
 */
export function useFamilyBoard() {
  const { keypair, isReady } = useStellarWallet();

  // The last-known-good decrypted board + its server version, kept in refs so the
  // async loop always reads current values without re-subscribing effects.
  const lastBoardRef = useRef<Board | null>(null);
  const versionRef = useRef<number>(0);
  const pendingNoticesRef = useRef<Signed<BoardNotice>[]>([]);
  const syncingRef = useRef(false);
  // Bumped on FAMILY_EVENT so the loop (re)starts the moment a family is created
  // or joined on this device — the effect below re-runs on this tick.
  const [familyTick, setFamilyTick] = useState(0);
  useEffect(() => {
    const bump = () => setFamilyTick((t) => t + 1);
    window.addEventListener(FAMILY_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(FAMILY_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  /** The active family's board coordinates, or null when sync is disabled. */
  const coords = useCallback((): { family: Family; boardId: string; familyKey: string } | null => {
    const family = loadFamily();
    if (!family || !family.boardId || !family.familyKey) return null;
    return { family, boardId: family.boardId, familyKey: family.familyKey };
  }, []);

  /** One full pull: GET → decrypt → verify → merge into local. */
  const pull = useCallback(async (): Promise<Board | null> => {
    const c = coords();
    if (!c) return null;
    const rec = await getBoardRecord(c.boardId);
    if (!rec) return null;
    let board: Board;
    try {
      board = await decryptBoard(rec.blob, c.familyKey);
    } catch {
      return null; // unreadable (wrong key / tamper) — keep local state
    }
    lastBoardRef.current = board;
    versionRef.current = rec.version;
    mergeIntoLocal(board, c.family);
    return board;
  }, [coords]);

  /**
   * One full push: build the outbound board from local state + this device's
   * signed sections, encrypt, PUT next version. On 409, re-pull/re-merge and
   * retry with bounded backoff. Serialized by `syncingRef` so overlapping nudges
   * don't stampede the server.
   */
  const push = useCallback(async (): Promise<void> => {
    if (syncingRef.current) return;
    const c = coords();
    if (!c) return;
    syncingRef.current = true;
    try {
      // Make sure we're building on the latest server state.
      await pull();
      for (let attempt = 0; attempt <= RETRY_BACKOFFS.length; attempt++) {
        const family = loadFamily();
        if (!family) return;
        const localStates = loadChoreStates();
        const outbound = buildOutboundBoard(
          lastBoardRef.current,
          family,
          keypair,
          localStates,
          pendingNoticesRef.current,
        );
        const blob = await encryptBoard(outbound, c.familyKey);
        const nextVersion = versionRef.current + 1;
        const res = await putBoardRecord(c.boardId, nextVersion, blob);
        if (res.kind === "ok") {
          lastBoardRef.current = outbound;
          versionRef.current = nextVersion;
          pendingNoticesRef.current = []; // notices landed
          // Reflect our own just-pushed board back into local (e.g. notices feed).
          mergeIntoLocal(outbound, family);
          return;
        }
        if (res.kind === "offline") return; // server down — try again next poll
        // conflict: adopt the server's current record, re-merge, then retry.
        if (res.current) {
          try {
            const merged = await decryptBoard(res.current.blob, c.familyKey);
            lastBoardRef.current = merged;
            versionRef.current = res.current.version;
            mergeIntoLocal(merged, family);
          } catch {
            /* unreadable server record — bail, next poll recovers */
            return;
          }
        } else {
          await pull();
        }
        if (attempt < RETRY_BACKOFFS.length) {
          await new Promise((r) => setTimeout(r, RETRY_BACKOFFS[attempt]));
        }
      }
    } finally {
      syncingRef.current = false;
    }
  }, [coords, keypair, pull]);

  /** Nudge an immediate sync after a local mutation (pull then push). */
  const pushNow = useCallback(() => {
    void push();
  }, [push]);

  /**
   * Author a signed notice from this device and push it. `author` is stamped as
   * this device's address so the merge's author check passes. Used by join
   * (kid-joined) now; task #4's flows call it for reward-ready etc.
   */
  const postNotice = useCallback(
    (notice: Omit<BoardNotice, "author">) => {
      const signed = signSection<BoardNotice>(
        { ...notice, author: keypair.publicKey() },
        keypair,
      );
      pendingNoticesRef.current = [...pendingNoticesRef.current, signed];
      void push();
    },
    [keypair, push],
  );

  // ── the loop: initial pull + seed, interval, focus/visibility, mutation events ─
  //
  // Re-runs when the wallet becomes ready AND whenever family membership changes
  // (familyTick) — so creating or joining a family kicks the loop off immediately
  // rather than only at page-load time.
  useEffect(() => {
    if (!isReady) return;

    let cancelled = false;

    // A mutation-triggered push always works, even if there's no family yet at
    // attach time (push() itself re-checks coords). Attached unconditionally so a
    // freshly-created family's seed push isn't dropped on the floor.
    const onLocalMutation = () => pushNow();
    const onFocus = () => void pull();
    const onVisible = () => {
      if (document.visibilityState === "visible") void pull();
    };
    window.addEventListener("maestro:board-push", onLocalMutation);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    const c = coords();
    let interval: ReturnType<typeof setInterval> | undefined;

    if (c) {
      // A new family on this device starts a fresh board — reset the version refs
      // so a leftover version from a previous family can't misalign the first PUT.
      if (versionRef.current > 0 && lastBoardRef.current === null) versionRef.current = 0;

      // Initial: pull; if no board yet AND we're the parent, seed it (version 1).
      (async () => {
        const board = await pull();
        if (cancelled) return;
        if (!board && c.family.role === "parent") {
          await push();
        }
        // A kid whose address isn't on the board yet publishes it + a join notice.
        if (!cancelled && c.family.role === "kid" && c.family.kidName) {
          const mine = lastBoardRef.current?.kids?.[c.family.kidName];
          const published = mine
            ? verifySection(mine, mine.signer)?.address === keypair.publicKey()
            : false;
          if (!published) {
            postNotice({
              id: `join-${c.family.kidName}-${randomId()}`,
              at: Date.now(),
              kind: "kid-joined",
              kidName: c.family.kidName,
            });
            // postNotice's push also publishes the kid's presence section.
          }
        }
      })();

      interval = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        void pull();
      }, POLL_MS);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("maestro:board-push", onLocalMutation);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Re-run on wallet-ready and on any family membership change (familyTick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, familyTick]);

  return { pushNow, postNotice };
}

/** Fire-and-forget: ask the mounted board hook to push after a local mutation. */
export function requestBoardPush(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("maestro:board-push"));
  }
}
