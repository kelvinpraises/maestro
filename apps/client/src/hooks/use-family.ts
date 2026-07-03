// use-family.ts — React hooks over the serverless family layer (src/lib/family.ts).
//
// Role is per-device:
//   • createFamily(...)  → this device becomes a "parent".
//   • joinFamily(...)    → this device becomes a "kid" (from an invite link).
//
// Family + chores live in localStorage; chores are shared via the invite link.
// Per-kid chore states (todo/pending/done) are stored separately per device.

import { useCallback, useEffect, useState } from "react";
import {
  loadFamily,
  saveFamily,
  clearFamily,
  loadChoreStates,
  saveChoreStates,
  emitFamilyChanged,
  emitChoreStatesChanged,
  effectiveChoreState,
  recordDone,
  loadDoneLog,
  streakForKid,
  loadGoal,
  saveGoal as persistGoal,
  scoopedXlmWithin,
  FAMILY_EVENT,
  CHORE_STATE_EVENT,
  DONE_LOG_EVENT,
  GOAL_EVENT,
  SCOOP_LOG_EVENT,
  FEED_EVENT,
  NOTICES_SEEN_EVENT,
  loadFamilyFeed,
  loadInboxNotices,
  loadNoticesSeenAt,
  markNoticesSeen,
  randomId,
  randomCapability,
  type Family,
  type FamilyRole,
  type FeedEntry,
  type Chore,
  type ChoreState,
  type ChoreStates,
  type ChoreStateEntry,
  type InvitePayload,
  type SavingsGoal,
} from "@/lib/family";
import { generateFamilyKey } from "@/lib/board";
import { requestBoardPush } from "@/hooks/use-family-board";

// ── useFamily — the family membership on this device ─────────────────────────

export function useFamily() {
  const [family, setFamily] = useState<Family | null>(() =>
    typeof window === "undefined" ? null : loadFamily(),
  );

  useEffect(() => {
    const reload = () => setFamily(loadFamily());
    window.addEventListener(FAMILY_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(FAMILY_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const persist = useCallback((next: Family | null) => {
    if (next) saveFamily(next);
    else clearFamily();
    emitFamilyChanged();
    setFamily(next);
  }, []);

  /**
   * Create a family on THIS device → role: parent. Async because it mints the
   * encrypted board's AES-GCM family key at creation (WebCrypto). The board id
   * doubles as the family id (a 128-bit capability). If key generation somehow
   * fails, the family is still created — just without board sync (degrades to
   * links-by-hand, exactly like an old family).
   */
  const createFamily = useCallback(
    async (input: {
      name: string;
      parentAddress: string;
      kidNames?: string[];
      chores?: Chore[];
    }): Promise<Family> => {
      const id = randomCapability(); // 128-bit capability, valid board id
      let familyKey: string | undefined;
      try {
        familyKey = await generateFamilyKey();
      } catch {
        familyKey = undefined; // sync disabled, app still works
      }
      const next: Family = {
        id,
        name: input.name.trim() || "My Family",
        role: "parent",
        parentAddress: input.parentAddress,
        kidNames: (input.kidNames ?? []).map((n) => n.trim()).filter(Boolean),
        chores: input.chores ?? [],
        createdAt: Date.now(),
        ...(familyKey ? { familyKey, boardId: id } : {}),
      };
      persist(next);
      requestBoardPush(); // seed the board (version 1) if key generation worked
      return next;
    },
    [persist],
  );

  /**
   * Join a family from an invite link on THIS device → role: kid. Board fields
   * (boardId/familyKey) ride the invite when present; an OLD link without them
   * still joins fine — just unsynced.
   */
  const joinFamily = useCallback(
    (payload: InvitePayload): Family => {
      const next: Family = {
        id: payload.familyId || randomId(),
        name: payload.familyName || "My Family",
        role: "kid",
        parentAddress: payload.parentAddress,
        kidNames: [],
        kidName: payload.kidName,
        chores: payload.chores ?? [],
        createdAt: Date.now(),
        // Board sync only when the invite carried both fields.
        ...(payload.boardId && payload.familyKey
          ? { boardId: payload.boardId, familyKey: payload.familyKey }
          : {}),
      };
      persist(next);
      requestBoardPush(); // publishes this kid's address + a kid-joined notice
      return next;
    },
    [persist],
  );

  const leaveFamily = useCallback(() => persist(null), [persist]);

  // ── chore management (parent affordances) ──────────────────────────────────

  const addChore = useCallback(
    (chore: Omit<Chore, "id">): Chore | null => {
      const cur = loadFamily();
      if (!cur) return null;
      const created: Chore = { id: randomId(), ...chore };
      persist({ ...cur, chores: [...cur.chores, created] });
      requestBoardPush(); // parent chore edits sync to kid devices
      return created;
    },
    [persist],
  );

  const removeChore = useCallback(
    (choreId: string) => {
      const cur = loadFamily();
      if (!cur) return;
      persist({ ...cur, chores: cur.chores.filter((c) => c.id !== choreId) });
      requestBoardPush();
    },
    [persist],
  );

  const addKidName = useCallback(
    (name: string) => {
      const cur = loadFamily();
      if (!cur) return;
      const trimmed = name.trim();
      if (!trimmed || cur.kidNames.includes(trimmed)) return;
      persist({ ...cur, kidNames: [...cur.kidNames, trimmed] });
      // kidNames aren't a board section (kids self-publish on join), but a push
      // is cheap and keeps the parent's board fresh.
      requestBoardPush();
    },
    [persist],
  );

  return {
    family,
    role: family?.role ?? null,
    hasFamily: !!family,
    createFamily,
    joinFamily,
    leaveFamily,
    addChore,
    removeChore,
    addKidName,
  };
}

// ── useChoreStates — per-kid chore progress (todo/pending/done), attributed ───
//
// v2 keys state by [choreId][kidName] = {state, at}. "todo" is the ABSENCE of a
// fresh entry, and freshness is derived at render from the chore's repeat
// cadence (effectiveChoreState) — a stale entry reads as todo again.

/** Per-kid effective state of a chore: { [kidName]: "pending" | "done" }. */
export type ChoreKidStates = Record<string, ChoreState>;

export function useChoreStates() {
  const [states, setStates] = useState<ChoreStates>(() =>
    typeof window === "undefined" ? {} : loadChoreStates(),
  );

  useEffect(() => {
    const reload = () => setStates(loadChoreStates());
    window.addEventListener(CHORE_STATE_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(CHORE_STATE_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  /**
   * Set (or clear) one kid's state for one chore. `state === null` clears the
   * entry entirely (→ todo). Setting stamps `at = now` so freshness resets.
   */
  const setChoreState = useCallback(
    (choreId: string, kidName: string, state: ChoreState | null) => {
      const name = kidName.trim();
      if (!name) return;
      const cur = loadChoreStates();
      const forChore = { ...(cur[choreId] ?? {}) };
      const now = Date.now();
      if (state === null || state === "todo") {
        delete forChore[name];
      } else {
        forChore[name] = { state, at: now };
      }
      const next: ChoreStates = { ...cur, [choreId]: forChore };
      // Prune an emptied chore map so absence stays clean.
      if (Object.keys(forChore).length === 0) delete next[choreId];
      saveChoreStates(next);
      // Every "done" — whoever records it (the parent-approve path today, a
      // kid-side path later) — appends to the append-only done log here, the one
      // chokepoint. Streaks read that log, not this current-period map.
      if (state === "done") recordDone(choreId, name, now);
      emitChoreStatesChanged();
      setStates(next);
      // Push the change to the board: a kid's "I did it" reaches the parent's nod
      // queue across devices; the parent's "done" reaches the kid's home.
      requestBoardPush();
    },
    [],
  );

  /**
   * The effective per-kid states for a chore at render time, freshness-derived
   * from the chore's repeat cadence. Only kids with a fresh pending/done entry
   * appear; everyone else is (absent =) todo.
   */
  const statesFor = useCallback(
    (chore: Pick<Chore, "id" | "repeat">, now: number = Date.now()): ChoreKidStates => {
      const forChore = states[chore.id] ?? {};
      const out: ChoreKidStates = {};
      for (const [kidName, entry] of Object.entries(forChore)) {
        const eff = effectiveChoreState(chore, entry as ChoreStateEntry, now);
        if (eff !== "todo") out[kidName] = eff;
      }
      return out;
    },
    [states],
  );

  /** One kid's effective state for a chore (todo when absent/stale). */
  const stateFor = useCallback(
    (
      chore: Pick<Chore, "id" | "repeat">,
      kidName: string,
      now: number = Date.now(),
    ): ChoreState =>
      effectiveChoreState(chore, states[chore.id]?.[kidName.trim()], now),
    [states],
  );

  return { states, setChoreState, statesFor, stateFor };
}

// ── useKidStreak — real consecutive-days streak from the done log ─────────────
//
// Recomputes on the done-log change event (a fresh done) and cross-tab storage.
// Returns 0 when the streak has lapsed or there's no history; callers render
// nothing on 0 (no sad zero).

export function useKidStreak(kidName: string | undefined): number {
  const name = kidName?.trim() ?? "";
  const compute = useCallback(
    () => (name ? streakForKid(name, loadDoneLog()) : 0),
    [name],
  );
  const [streak, setStreak] = useState<number>(() =>
    typeof window === "undefined" ? 0 : compute(),
  );
  useEffect(() => {
    const reload = () => setStreak(compute());
    reload(); // name may have changed
    window.addEventListener(DONE_LOG_EVENT, reload);
    window.addEventListener(CHORE_STATE_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(DONE_LOG_EVENT, reload);
      window.removeEventListener(CHORE_STATE_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, [compute]);
  return streak;
}

// ── useSavingsGoal — the kid-set goal (name + target), per device ────────────
//
// One store feeds both the /me goal card and the stash mini-card's goal line.
// `null` = no goal set yet (empty state / hidden line).

export function useSavingsGoal() {
  const [goal, setGoal] = useState<SavingsGoal | null>(() =>
    typeof window === "undefined" ? null : loadGoal(),
  );
  useEffect(() => {
    const reload = () => setGoal(loadGoal());
    window.addEventListener(GOAL_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(GOAL_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  const setSavingsGoal = useCallback((next: SavingsGoal | null) => {
    persistGoal(next);
    setGoal(next);
  }, []);
  return { goal, setSavingsGoal };
}

// ── useScoopedThisWeek — XLM scooped in the last 7 days, from the scoop log ───
//
// Added to claimed-reward XLM (in the screen) to form "earned this week" so the
// number matches what the kid watched land (audit issue 5).

export function useScoopedThisWeek(): number {
  const compute = useCallback(() => scoopedXlmWithin(), []);
  const [xlm, setXlm] = useState<number>(() =>
    typeof window === "undefined" ? 0 : compute(),
  );
  useEffect(() => {
    const reload = () => setXlm(compute());
    window.addEventListener(SCOOP_LOG_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(SCOOP_LOG_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, [compute]);
  return xlm;
}

// ── useFamilyFeed — the warm "our family" activity: board notices + local notes ─
//
// The family feed (audit issue 11) is attributable and cross-device: signed board
// notices (kid-joined, reward-ready…) fused with this device's own local notes.
// It's distinct from the raw treasury/chain feed, which now lives on /me. Reloads
// on the same-tab FEED_EVENT (a merge cached new notices, or a local note landed)
// and cross-tab storage.

export function useFamilyFeed(): FeedEntry[] {
  const [feed, setFeed] = useState<FeedEntry[]>(() =>
    typeof window === "undefined" ? [] : loadFamilyFeed(),
  );
  useEffect(() => {
    const reload = () => setFeed(loadFamilyFeed());
    window.addEventListener(FEED_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(FEED_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  return feed;
}

// ── useNoticesInbox — the bell: this device's relevant notices + unseen count ──
//
// The bell (audit survivor) returns as the notices inbox. This hook reads the
// role-scoped board notices (newest-first) and derives an unseen count from the
// locally-stored last-seen timestamp. `markSeen()` clears the badge (called when
// the sheet opens); it persists, so the badge stays cleared across reloads.
// Reloads on FEED_EVENT (a merge cached new notices) and the seen-changed event.

export function useNoticesInbox(role: FamilyRole | null, kidName?: string) {
  const name = kidName?.trim();
  const compute = useCallback(
    () => (typeof window === "undefined" ? [] : loadInboxNotices(role, name)),
    [role, name],
  );
  const [notices, setNotices] = useState<FeedEntry[]>(compute);
  const [seenAt, setSeenAt] = useState<number>(() =>
    typeof window === "undefined" ? 0 : loadNoticesSeenAt(),
  );

  useEffect(() => {
    const reloadNotices = () => setNotices(compute());
    const reloadSeen = () => setSeenAt(loadNoticesSeenAt());
    reloadNotices(); // role/kidName may have changed
    window.addEventListener(FEED_EVENT, reloadNotices);
    window.addEventListener(NOTICES_SEEN_EVENT, reloadSeen);
    window.addEventListener("storage", () => {
      reloadNotices();
      reloadSeen();
    });
    return () => {
      window.removeEventListener(FEED_EVENT, reloadNotices);
      window.removeEventListener(NOTICES_SEEN_EVENT, reloadSeen);
    };
  }, [compute]);

  const unseenCount = notices.filter((n) => n.at > seenAt).length;
  const markSeen = useCallback(() => {
    // Seal to the newest notice's timestamp (or now) so future notices still
    // badge, but everything currently shown reads as seen.
    const newest = notices.reduce((m, n) => Math.max(m, n.at), Date.now());
    markNoticesSeen(newest);
    setSeenAt(newest);
  }, [notices]);

  return { notices, unseenCount, markSeen };
}
