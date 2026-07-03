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
  FAMILY_EVENT,
  CHORE_STATE_EVENT,
  randomId,
  type Family,
  type Chore,
  type ChoreState,
  type InvitePayload,
} from "@/lib/family";

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

  /** Create a family on THIS device → role: parent. */
  const createFamily = useCallback(
    (input: {
      name: string;
      parentAddress: string;
      kidNames?: string[];
      chores?: Chore[];
    }): Family => {
      const next: Family = {
        id: randomId(),
        name: input.name.trim() || "My Family",
        role: "parent",
        parentAddress: input.parentAddress,
        kidNames: (input.kidNames ?? []).map((n) => n.trim()).filter(Boolean),
        chores: input.chores ?? [],
        createdAt: Date.now(),
      };
      persist(next);
      return next;
    },
    [persist],
  );

  /** Join a family from an invite link on THIS device → role: kid. */
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
      };
      persist(next);
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
      return created;
    },
    [persist],
  );

  const removeChore = useCallback(
    (choreId: string) => {
      const cur = loadFamily();
      if (!cur) return;
      persist({ ...cur, chores: cur.chores.filter((c) => c.id !== choreId) });
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

// ── useChoreStates — per-device kid chore progress (todo/pending/done) ────────

export function useChoreStates() {
  const [states, setStates] = useState<Record<string, ChoreState>>(() =>
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

  const setChoreState = useCallback((choreId: string, state: ChoreState) => {
    const next = { ...loadChoreStates(), [choreId]: state };
    saveChoreStates(next);
    emitChoreStatesChanged();
    setStates(next);
  }, []);

  return { states, setChoreState };
}
