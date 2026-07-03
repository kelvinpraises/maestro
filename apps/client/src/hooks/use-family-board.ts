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
  recordLocalNote,
  loadLocalNotes,
  noteFromClaimLink,
  importNote,
  randomId,
  FAMILY_EVENT,
  type Family,
  type Chore,
  type ChoreStates,
  type FeedEntry,
} from "@/lib/family";
import { deriveNote } from "@/lib/claims";

const POLL_MS = 8_000;
/** Backoff schedule for a PUT that keeps 409-ing (bounded, then give up). */
const RETRY_BACKOFFS = [150, 400, 900];
/** localStorage flag prefix: this device already posted its kid-joined notice
 *  for a given board+kid (announce once, independent of presence timing). */
const JOIN_ANNOUNCED_KEY = "maestro.join-announced.v1";

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

  // 3) Fill the kid-addresses map from published kids (feeds the allowance
  //    picker), AND — on the parent device — reconcile the roster: a kid who
  //    joined via invite self-publishes under view.kids, so any name the parent
  //    doesn't yet list gets added to family.kidNames. Without this a freshly
  //    joined kid never appears in the parent's Kids group (the reported
  //    "kid-joined is broken" bug); the kid-joined NOTICE landed but the roster
  //    didn't. Parent-authoritative for the roster; the kid device keeps its own
  //    single-kid membership and skips this.
  const joinedNames: string[] = [];
  for (const [kidName, kid] of Object.entries(view.kids)) {
    if (kid.address) setKidAddress(kidName, kid.address); // no-ops when unchanged
    joinedNames.push(kidName);
  }
  if (family.role === "parent" && joinedNames.length > 0) {
    const missing = joinedNames.filter((n) => !family.kidNames.includes(n));
    if (missing.length > 0) {
      saveFamily({ ...family, kidNames: [...family.kidNames, ...missing] });
      emitFamilyChanged();
      changed = true;
    }
  }

  // 4) AUTO-IMPORT reward-ready notices addressed to THIS kid: drop the claim
  //    note straight into the rewards store (same dedupe-by-id as /claim-link),
  //    so the kid's /rewards lights up with no link pasting. Dedupe is twofold:
  //    importNote is id-based (idempotent), and we only record a family-feed
  //    entry the FIRST time we act on a given notice id (tracked in local notes).
  if (family.role === "kid" && family.kidName) {
    const me = family.kidName.trim();
    const seenLocalIds = new Set(loadLocalNotes().map((n) => n.id));
    for (const n of view.notices) {
      if (n.kind !== "reward-ready" || !n.claim) continue;
      if (n.kidName && n.kidName !== me) continue; // not for me
      // Import the note (idempotent on the reward id). We key the family-feed
      // dedupe on the NOTICE id so repeated polls of the same notice never add a
      // second row, independent of whether the underlying note already existed.
      const note = noteFromClaimLink(n.claim, (secret, amountStroops) => {
        const derived = deriveNote(secret, amountStroops);
        return "0x" + derived.nullifier.toString(16).padStart(64, "0");
      });
      const imported = importNote(note);
      if (imported) {
        // A brand-new reward landed on this device → refresh the rewards list.
        if (typeof window !== "undefined")
          window.dispatchEvent(new Event("maestro:reward-notes-changed"));
        changed = true;
      }
      // Record the "reward arrived" family-feed row exactly once per notice id.
      if (!seenLocalIds.has(n.id)) {
        recordLocalNote({
          id: n.id,
          at: n.at,
          kind: "reward-ready",
          kidName: n.kidName,
          text: n.label
            ? `A reward arrived: ${n.label}`
            : "A reward arrived for you",
        });
        seenLocalIds.add(n.id);
      }
    }
  }

  // 5) Cache board notices for the family feed + the bell inbox (attributable,
  //    warm). Carry the kind-specific display fields so the feed/bell can render
  //    amounts and rates without decoding the claim payload.
  const feedRows: FeedEntry[] = view.notices.map((n) => ({
    id: n.id,
    at: n.at,
    kind: n.kind,
    ...(n.kidName ? { kidName: n.kidName } : {}),
    ...(n.text ? { text: n.text } : {}),
    ...(n.emoji ? { emoji: n.emoji } : {}),
    ...(typeof n.amountXlm === "number" ? { amountXlm: n.amountXlm } : {}),
    ...(n.label ? { label: n.label } : {}),
    ...(typeof n.rateXlm === "number" ? { rateXlm: n.rateXlm } : {}),
    ...(n.period ? { period: n.period } : {}),
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
  // Set when a push is requested while one is already in flight. Without this, a
  // second push() returns immediately (serialized by syncingRef) and anything it
  // meant to flush — notably a kid-joined notice queued right after join's own
  // presence push — is stranded until the next unrelated mutation. On this flag,
  // push() loops once more when it finishes, coalescing the queued work.
  const pushAgainRef = useRef(false);
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
    // Already syncing → remember that more work wants pushing and let the
    // in-flight run pick it up when it finishes (see the finally below).
    if (syncingRef.current) {
      pushAgainRef.current = true;
      return;
    }
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
      // Coalesced re-run: a push arrived mid-flight (its call was serialized
      // away). Flush it now that we're free. Guarded by an explicit flag (not by
      // "pending notices remain") so a persistent offline PUT can't busy-loop —
      // stranded notices are instead retried by the poll interval below.
      if (pushAgainRef.current) {
        pushAgainRef.current = false;
        queueMicrotask(() => void pushRef.current?.());
      }
    }
  }, [coords, keypair, pull]);

  // Hold the latest push in a ref so the coalesced re-run (inside push's own
  // finally) can call it without a self-reference at definition time.
  const pushRef = useRef<typeof push | null>(null);
  pushRef.current = push;

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
    // Flow code (approve, allowance, add-chore, send-a-note) posts a notice by
    // firing this event with the notice detail — no context/prop-drilling needed,
    // mirroring requestBoardPush. `author` is stamped inside postNotice.
    const onPostNotice = (e: Event) => {
      const detail = (e as CustomEvent<Omit<BoardNotice, "author">>).detail;
      if (detail) postNotice(detail);
    };
    window.addEventListener("maestro:board-push", onLocalMutation);
    window.addEventListener("maestro:board-post-notice", onPostNotice);
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
        // A kid announces its join ONCE per device+family — a "kid-joined"
        // notice (for the parent's bell + feed) plus its presence section (the
        // postNotice push publishes both). This is gated on a local
        // already-announced flag, NOT on whether the presence is already on the
        // board: the presence can land first (join's own requestBoardPush), which
        // would otherwise make the announce think it was already done and strand
        // the notice — the reported "kid-joined doesn't reach the parent" bug.
        if (!cancelled && c.family.role === "kid" && c.family.kidName) {
          const flag = `${JOIN_ANNOUNCED_KEY}:${c.boardId}:${c.family.kidName}`;
          let announced = false;
          try {
            announced = localStorage.getItem(flag) === "1";
          } catch {
            /* private mode — fall back to announcing */
          }
          if (!announced) {
            try {
              localStorage.setItem(flag, "1");
            } catch {
              /* ignore */
            }
            postNotice({
              id: `join-${c.family.kidName}-${randomId()}`,
              at: Date.now(),
              kind: "kid-joined",
              kidName: c.family.kidName,
            });
          }
        }
      })();

      interval = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        // Flush any stranded pending notices (push pulls first); otherwise just
        // pull. A push whose turn was serialized away lands on the next tick.
        if (pendingNoticesRef.current.length > 0) void push();
        else void pull();
      }, POLL_MS);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("maestro:board-push", onLocalMutation);
      window.removeEventListener("maestro:board-post-notice", onPostNotice);
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

/**
 * Fire-and-forget: ask the mounted board hook to sign + post a notice from this
 * device and push it. `author` is stamped inside the hook (this device's key), so
 * callers pass everything BUT the author. Used by task #4's flows (reward-ready,
 * allowance-started, message) — the same pattern as requestBoardPush, so flow
 * code needs no context or prop-drilling.
 */
export function requestPostNotice(notice: Omit<BoardNotice, "author">): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("maestro:board-post-notice", { detail: notice }),
    );
  }
}
