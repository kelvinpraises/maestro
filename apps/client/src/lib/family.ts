// family.ts — pure (no-React) data + link-codec layer for Maestro's serverless
// family layer. Everything here is links + localStorage + chain; there is NO
// server. The three moving pieces:
//
//   1. FAMILY  — created on the parent device (family name + kid names, no
//      accounts). Role is per-device: creating a family → "parent"; opening an
//      invite link → "kid". Stored in localStorage.
//   2. CHORES  — defined by the parent (name, emoji, reward XLM). Stored under
//      the family. Encoded into the invite link so a kid device gets them too.
//   3. LINKS   — two compact, self-contained URLs:
//        • invite link  (#invite=<blob>) carries {familyName, kidName,
//          parentAddress, chores} so a kid device can join with no round-trip.
//        • claim link   (#claim=<blob>)  carries one reward note's {secret,
//          amountStroops, label} so the kid device can import + privately claim.
//
// This module is React-free so it can be unit-tested under tsx/node as well as
// run in the browser. It only touches `localStorage`/`window` behind guards.

import type { ClaimNote } from "@/lib/claims";

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export type FamilyRole = "parent" | "kid";

/** How often a chore comes back. Absent = "daily" (the default). */
export type ChoreRepeat = "daily" | "weekly" | "once";

/** One chore the parent defined. Reward is stored as an XLM number for display. */
export interface Chore {
  /** Stable local id. */
  id: string;
  /** Chore name ("Make the bed"). */
  name: string;
  /** A single emoji for the tile. */
  emoji: string;
  /** Reward in XLM. */
  rewardXlm: number;
  /**
   * Optional context ("how it should be done, who's involved"). Shown on the
   * kid's "I did it!" confirm and as a small line under the chore name.
   * Travels in the invite link as an OPTIONAL trailing tuple element, so old
   * links without it keep decoding fine.
   */
  note?: string;
  /**
   * Who owns this chore: a kidName, or ABSENT for "anyone" (first-claim, shared
   * — "whoever empties the dishwasher"). A chore assigned to a kid only shows on
   * that kid's home; anyone-chores show on every kid's home. Travels in the
   * invite link; omitted when absent so old/anyone links stay compact.
   */
  assignee?: string;
  /**
   * How often the chore resets. ABSENT = "daily". Freshness is derived at render
   * from each state entry's `at` timestamp (no scheduler) — see
   * effectiveChoreState. Travels in the invite link; omitted when "daily".
   */
  repeat?: ChoreRepeat;
}

/** A kid's local state for a chore. "todo" is the ABSENCE of a fresh entry. */
export type ChoreState = "todo" | "pending" | "done";

/**
 * One stored state entry for a (chore, kid) pair. Only "pending"/"done" are
 * ever stored — "todo" is the absence of a (fresh) entry. `at` is the unix-ms
 * moment the state was set, which drives freshness derivation.
 */
export interface ChoreStateEntry {
  state: "pending" | "done";
  at: number;
}

/** v2 per-kid chore states: { [choreId]: { [kidName]: ChoreStateEntry } }. */
export type ChoreStates = Record<string, Record<string, ChoreStateEntry>>;

/**
 * The family membership stored on this device. A device with no family sees the
 * friendly setup card; a device that created one is a parent; a device that
 * joined via link is a kid.
 */
export interface Family {
  /** Stable local id (parent's, minted at creation). */
  id: string;
  /** Family name ("The Smiths"). */
  name: string;
  /** This device's role. */
  role: FamilyRole;
  /** Parent's Stellar address — funds rewards, roots the family. */
  parentAddress: string;
  /** Kid names the parent added (parent device only; informational on kid). */
  kidNames: string[];
  /** On a kid device: which kid this device belongs to. */
  kidName?: string;
  /** The shared chore list. */
  chores: Chore[];
  /** Unix ms created/joined. */
  createdAt: number;
  /**
   * The encrypted family board's shared symmetric key (AES-GCM, base64url), and
   * the board id (a base64url capability, also this family's `id` when minted
   * fresh). BOTH are optional so a family created before the board landed — or
   * joined via an old invite link without board fields — keeps working with sync
   * simply disabled. When present, use-family-board syncs against them.
   */
  familyKey?: string;
  /** The board capability id (server path). Defaults to `id` when board-enabled. */
  boardId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  localStorage
// ─────────────────────────────────────────────────────────────────────────────

export const FAMILY_STORAGE_KEY = "maestro.family.v1";
/** Legacy flat states: { [choreId]: ChoreState }. Migrated → v2 on first load. */
export const CHORE_STATE_STORAGE_KEY_V1 = "maestro.chore-states.v1";
/** Per-kid chore states: { [choreId]: { [kidName]: {state, at} } }. */
export const CHORE_STATE_STORAGE_KEY = "maestro.chore-states.v2";

/** Same storage key + shape use-rewards reads (see NOTES_STORAGE_KEY there). */
export const NOTES_STORAGE_KEY = "maestro.reward-notes.v1";

export function loadFamily(): Family | null {
  try {
    const raw = localStorage.getItem(FAMILY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Family;
    if (!parsed || typeof parsed !== "object" || !parsed.id) return null;
    // Defensive defaults for forward-compat.
    parsed.chores = Array.isArray(parsed.chores) ? parsed.chores : [];
    parsed.kidNames = Array.isArray(parsed.kidNames) ? parsed.kidNames : [];
    return parsed;
  } catch {
    return null;
  }
}

export function saveFamily(family: Family): void {
  try {
    localStorage.setItem(FAMILY_STORAGE_KEY, JSON.stringify(family));
  } catch {
    // Non-fatal in the demo.
  }
}

export function clearFamily(): void {
  try {
    localStorage.removeItem(FAMILY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * One-time v1 → v2 migration. If the flat v1 map exists and v2 doesn't yet,
 * lift each v1 entry under a single kid name:
 *   • kid device  → the device's own kid (family.kidName)
 *   • parent device with exactly one kid → that sole kid
 *   • otherwise (parent, 0 or ≥2 kids) → drop (no way to attribute honestly)
 * "todo" v1 entries carry no meaning under v2 (todo = absence), so only
 * pending/done are lifted. v1 is deleted afterwards regardless.
 */
function migrateChoreStatesV1(): ChoreStates | null {
  let rawV1: string | null;
  try {
    rawV1 = localStorage.getItem(CHORE_STATE_STORAGE_KEY_V1);
  } catch {
    return null;
  }
  if (rawV1 == null) return null;
  // Only migrate when v2 is genuinely absent (never clobber a real v2 map).
  let hasV2 = false;
  try {
    hasV2 = localStorage.getItem(CHORE_STATE_STORAGE_KEY) != null;
  } catch {
    /* ignore */
  }

  const next: ChoreStates = {};
  if (!hasV2) {
    // Find the kid name to attribute lifted entries to.
    const fam = loadFamily();
    const attributeTo =
      fam?.role === "kid"
        ? fam.kidName?.trim() || null
        : fam && fam.kidNames.length === 1
          ? fam.kidNames[0]
          : null;
    if (attributeTo) {
      try {
        const v1 = JSON.parse(rawV1) as Record<string, ChoreState>;
        if (v1 && typeof v1 === "object") {
          const at = Date.now();
          for (const [choreId, state] of Object.entries(v1)) {
            if (state === "pending" || state === "done") {
              next[choreId] = { [attributeTo]: { state, at } };
            }
          }
        }
      } catch {
        /* corrupt v1 — drop it */
      }
    }
    try {
      localStorage.setItem(CHORE_STATE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  // Delete v1 either way — its job is done.
  try {
    localStorage.removeItem(CHORE_STATE_STORAGE_KEY_V1);
  } catch {
    /* ignore */
  }
  return hasV2 ? null : next;
}

export function loadChoreStates(): ChoreStates {
  try {
    const migrated = migrateChoreStatesV1();
    if (migrated) return migrated;
    const raw = localStorage.getItem(CHORE_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ChoreStates;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveChoreStates(states: ChoreStates): void {
  try {
    localStorage.setItem(CHORE_STATE_STORAGE_KEY, JSON.stringify(states));
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Done log — append-only history of every chore "done", per kid. Streak lives
//  here (consecutive calendar days with ≥1 done), not in the freshness-derived
//  states map (which only ever holds the CURRENT period). Capped so a long-lived
//  device can't grow it without bound. Every done write (kid-side or the
//  parent-approve path) funnels through setChoreState → recordDone here.
//    Shape: [{ choreId, kidName, at }]  (newest appended last)
// ─────────────────────────────────────────────────────────────────────────────

export const DONE_LOG_STORAGE_KEY = "maestro.done-log.v1";
export const DONE_LOG_EVENT = "maestro:done-log-changed";
/** Keep the tail — enough for any real streak, small enough to stay cheap. */
const DONE_LOG_CAP = 500;

export interface DoneLogEntry {
  choreId: string;
  kidName: string;
  /** Unix ms the done was recorded. */
  at: number;
}

export function loadDoneLog(): DoneLogEntry[] {
  try {
    const raw = localStorage.getItem(DONE_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DoneLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Append one done to the log (capped, newest last). Emits a same-tab change
 * event so open streak views refresh. Called from setChoreState whenever a
 * "done" is recorded, so every done path logs exactly once.
 */
export function recordDone(choreId: string, kidName: string, at: number = Date.now()): void {
  const name = kidName.trim();
  if (!name) return;
  try {
    const log = loadDoneLog();
    log.push({ choreId, kidName: name, at });
    const capped = log.length > DONE_LOG_CAP ? log.slice(log.length - DONE_LOG_CAP) : log;
    localStorage.setItem(DONE_LOG_STORAGE_KEY, JSON.stringify(capped));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(DONE_LOG_EVENT));
  } catch {
    /* non-fatal in the demo */
  }
}

/**
 * The current streak for one kid: consecutive local calendar days, ending today
 * OR yesterday, on each of which the kid has ≥1 done-log entry. Returns 0 when
 * the most recent done is older than yesterday (the streak has lapsed) or there
 * is no history. A zero streak renders nothing (no sad zero) — callers guard.
 */
export function streakForKid(
  kidName: string,
  log: DoneLogEntry[] = loadDoneLog(),
  now: number = Date.now(),
): number {
  const name = kidName.trim();
  if (!name) return 0;
  // Set of local day-keys this kid did ≥1 chore on.
  const days = new Set<string>();
  for (const e of log) {
    if (e.kidName === name) days.add(dayKey(e.at));
  }
  if (days.size === 0) return 0;

  const MS_DAY = 24 * 60 * 60 * 1000;
  const today = dayKey(now);
  const yesterday = dayKey(now - MS_DAY);
  // The streak must be "live": its latest day is today or yesterday, else 0.
  let cursor: number;
  if (days.has(today)) cursor = now;
  else if (days.has(yesterday)) cursor = now - MS_DAY;
  else return 0;

  let count = 0;
  while (days.has(dayKey(cursor))) {
    count++;
    cursor -= MS_DAY;
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Scoop log — append-only record of allowance the kid scooped into their stash.
//  "Earned this week" = claimed rewards (use-rewards) + scoops in the last 7
//  days, so the number matches what the kid watched happen (audit issue 5).
//    Shape: [{ amountStroops, at }]  (amountStroops a decimal string bigint)
// ─────────────────────────────────────────────────────────────────────────────

export const SCOOP_LOG_STORAGE_KEY = "maestro.scoop-log.v1";
export const SCOOP_LOG_EVENT = "maestro:scoop-log-changed";
const SCOOP_LOG_CAP = 500;

export interface ScoopLogEntry {
  /** Collected amount in stroops (decimal-string bigint — never a JS number). */
  amountStroops: string;
  /** Unix ms the scoop landed. */
  at: number;
}

export function loadScoopLog(): ScoopLogEntry[] {
  try {
    const raw = localStorage.getItem(SCOOP_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScoopLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Record one successful scoop (capped, newest last) + emit a change event. */
export function recordScoop(amountStroops: string, at: number = Date.now()): void {
  try {
    const log = loadScoopLog();
    log.push({ amountStroops, at });
    const capped = log.length > SCOOP_LOG_CAP ? log.slice(log.length - SCOOP_LOG_CAP) : log;
    localStorage.setItem(SCOOP_LOG_STORAGE_KEY, JSON.stringify(capped));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SCOOP_LOG_EVENT));
  } catch {
    /* non-fatal */
  }
}

/**
 * Total XLM scooped in the last `withinMs` (default 7 days). Sums the log's
 * stroop amounts and returns a display XLM number. Older scoops are excluded so
 * the "this week" framing stays honest.
 */
export function scoopedXlmWithin(
  withinMs: number = 7 * 24 * 60 * 60 * 1000,
  log: ScoopLogEntry[] = loadScoopLog(),
  now: number = Date.now(),
): number {
  const cutoff = now - withinMs;
  let stroops = 0n;
  for (const e of log) {
    if (e.at >= cutoff) {
      try {
        stroops += BigInt(e.amountStroops);
      } catch {
        /* skip a corrupt entry */
      }
    }
  }
  // stroops → XLM (7 decimals). Kept local to avoid a circular import of
  // src/lib/allowance's stroopsToXlm from this React-free module.
  return Number(stroops) / 10_000_000;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Savings goal — kid-set, per device. Empty until the kid names one; the /me
//  goal card and the stash mini-card's goal line both read this single store
//  (audit issue 6: no more hardcoded Lego). Progress = real balance / target.
//    Shape: { name, targetXlm }
// ─────────────────────────────────────────────────────────────────────────────

export const GOAL_STORAGE_KEY = "maestro.goal.v1";
export const GOAL_EVENT = "maestro:goal-changed";
/** The goal name is a short label; keep it a chip, not a paragraph. */
export const GOAL_NAME_MAX = 24;

export interface SavingsGoal {
  /** What the kid is saving for ("A new skateboard"). */
  name: string;
  /** Target in XLM. */
  targetXlm: number;
}

export function loadGoal(): SavingsGoal | null {
  try {
    const raw = localStorage.getItem(GOAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavingsGoal;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.name !== "string" ||
      typeof parsed.targetXlm !== "number"
    )
      return null;
    const name = parsed.name.trim();
    if (!name || !(parsed.targetXlm > 0)) return null;
    return { name: name.slice(0, GOAL_NAME_MAX), targetXlm: parsed.targetXlm };
  } catch {
    return null;
  }
}

/** Save (or, with null, clear) the goal. Emits a same-tab change event. */
export function saveGoal(goal: SavingsGoal | null): void {
  try {
    if (goal === null) {
      localStorage.removeItem(GOAL_STORAGE_KEY);
    } else {
      const name = goal.name.trim().slice(0, GOAL_NAME_MAX);
      if (!name || !(goal.targetXlm > 0)) return;
      localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify({ name, targetXlm: goal.targetXlm }));
    }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(GOAL_EVENT));
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Freshness — derived at render, no scheduler. A stored pending/done entry
//  only "counts" for the current period of the chore's repeat cadence; once the
//  period rolls over, the entry is stale and the chore reads as todo again.
// ─────────────────────────────────────────────────────────────────────────────

/** Local calendar-day key ("2026-07-03") for a unix-ms instant. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** ISO week key ("2026-W27") for a unix-ms instant (Mon-anchored). */
function isoWeekKey(ms: number): string {
  const d = new Date(ms);
  // Copy to UTC-ish midnight and shift to Thursday of the current week.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${date.getUTCFullYear()}-W${week}`;
}

/**
 * The effective state of a chore for one kid at time `now`, given that kid's
 * stored entry (or undefined). Returns "todo" when there's no entry OR the entry
 * is stale for the chore's repeat cadence:
 *   • daily  (default) — entry counts only on the same local calendar day.
 *   • weekly           — entry counts only within the same ISO week.
 *   • once             — entry counts forever.
 * A stale entry reads as todo (and may be overwritten by a fresh action).
 */
export function effectiveChoreState(
  chore: Pick<Chore, "repeat">,
  entry: ChoreStateEntry | undefined,
  now: number = Date.now(),
): ChoreState {
  if (!entry) return "todo";
  const repeat = chore.repeat ?? "daily";
  if (repeat === "once") return entry.state;
  const fresh =
    repeat === "weekly"
      ? isoWeekKey(entry.at) === isoWeekKey(now)
      : dayKey(entry.at) === dayKey(now);
  return fresh ? entry.state : "todo";
}

// ─────────────────────────────────────────────────────────────────────────────
//  Same-tab change events (localStorage `storage` only fires cross-tab)
// ─────────────────────────────────────────────────────────────────────────────

export const FAMILY_EVENT = "maestro:family-changed";
export const CHORE_STATE_EVENT = "maestro:chore-states-changed";

export function emitFamilyChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FAMILY_EVENT));
}
export function emitChoreStatesChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(CHORE_STATE_EVENT));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Small id helper (dependency-free; nanoid used at call sites for chores)
// ─────────────────────────────────────────────────────────────────────────────

export function randomId(): string {
  const g = globalThis as unknown as { crypto?: Crypto };
  if (g.crypto?.getRandomValues) {
    const b = new Uint8Array(9);
    g.crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

/**
 * A random 128-bit capability as a URL-safe base64url string (22 chars, no
 * padding). Doubles as the family board id — it's an unguessable secret the
 * parent mints once, and the board server validates it as base64url. This is the
 * ONLY thing gating access to a family's board, so it must be high-entropy.
 */
export function randomCapability(): string {
  const g = globalThis as unknown as { crypto?: Crypto };
  const bytes = new Uint8Array(16);
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  // base64url, no padding.
  let b64: string;
  if (typeof btoa === "function") {
    let bin = "";
    for (const byte of bytes) bin += String.fromCharCode(byte);
    b64 = btoa(bin);
  } else {
    b64 = Buffer.from(bytes).toString("base64");
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─────────────────────────────────────────────────────────────────────────────
//  base64url JSON codec (URL-safe, compact, no padding)
// ─────────────────────────────────────────────────────────────────────────────

function utf8ToBytes(s: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  return Uint8Array.from(Buffer.from(s, "utf-8"));
}
function bytesToUtf8(b: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
  return Buffer.from(b).toString("utf-8");
}

function bytesToBase64(bytes: Uint8Array): string {
  // Prefer btoa in the browser; fall back to Buffer in node.
  if (typeof btoa === "function") {
    let bin = "";
    for (const byte of bytes) bin += String.fromCharCode(byte);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}
function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(u: string): string {
  const b64 = u.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return b64 + pad;
}

/** Encode any JSON-serializable value into a compact base64url blob. */
export function encodeBlob(value: unknown): string {
  return toBase64Url(bytesToBase64(utf8ToBytes(JSON.stringify(value))));
}

/** Decode a base64url blob back into a value (throws on malformed input). */
export function decodeBlob<T>(blob: string): T {
  return JSON.parse(bytesToUtf8(base64ToBytes(fromBase64Url(blob)))) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Invite link — parent → kid: family + chores, no server round-trip.
//    URL shape:  <origin>/join#invite=<blob>
//  The wire payload uses short keys to stay compact for ~10 chores.
// ─────────────────────────────────────────────────────────────────────────────

export interface InvitePayload {
  familyId: string;
  familyName: string;
  parentAddress: string;
  kidName: string;
  chores: Chore[];
  /**
   * OPTIONAL board fields (backward-compatible). When both are present, the kid
   * device joins the encrypted family board and syncs; when ABSENT (an old link
   * minted before the board landed), the kid still joins fine — just unsynced.
   */
  boardId?: string;
  familyKey?: string;
}

/**
 * Compact wire form — short keys; chores as positional tuples. Growth is
 * append-only and default-eliding, so every older link shape still decodes:
 *   [id, name, emoji, rewardXlm]                       ← oldest (4-tuple)
 *   [id, name, emoji, rewardXlm, note]                 ← + note (5-tuple)
 *   [id, name, emoji, rewardXlm, note, assignee]       ← + assignee (6-tuple)
 *   [id, name, emoji, rewardXlm, note, assignee, rep]  ← + repeat (7-tuple)
 * Trailing defaults are elided so a plain anyone/daily/no-note chore stays a
 * 4-tuple exactly as before. When a later field is present but an earlier
 * optional one isn't, the earlier one is written as "" (note) / "" (assignee)
 * as a placeholder. `repeat` is encoded "w"|"o" (daily → absent).
 */
type RepeatCode = "w" | "o";
type ChoreTuple =
  | [string, string, string, number]
  | [string, string, string, number, string]
  | [string, string, string, number, string, string]
  | [string, string, string, number, string, string, RepeatCode];
interface InviteWire {
  i: string; // familyId
  f: string; // familyName
  p: string; // parentAddress
  k: string; // kidName
  c: ChoreTuple[]; // chores
  b?: string; // boardId (optional — absent on old links)
  y?: string; // familyKey (optional — absent on old links)
}

export function encodeInvite(payload: InvitePayload): string {
  const wire: InviteWire = {
    i: payload.familyId,
    f: payload.familyName,
    p: payload.parentAddress,
    k: payload.kidName,
    // Board fields ride along only when board-enabled; omitted keeps old links
    // byte-identical and lets a pre-board family invite decode unchanged.
    ...(payload.boardId ? { b: payload.boardId } : {}),
    ...(payload.familyKey ? { y: payload.familyKey } : {}),
    c: payload.chores.map((ch): ChoreTuple => {
      const note = ch.note?.trim() ?? "";
      const assignee = ch.assignee?.trim() ?? "";
      const rep: RepeatCode | "" =
        ch.repeat === "weekly" ? "w" : ch.repeat === "once" ? "o" : "";
      // Build the fullest tuple, then drop trailing defaults so a plain
      // anyone/daily/no-note chore is still a 4-tuple (compact as before).
      const full: [string, string, string, number, string, string, RepeatCode | ""] =
        [ch.id, ch.name, ch.emoji, ch.rewardXlm, note, assignee, rep];
      let end = 7;
      while (end > 4 && !full[end - 1]) end--;
      return full.slice(0, end) as ChoreTuple;
    }),
  };
  return encodeBlob(wire);
}

export function decodeInvite(blob: string): InvitePayload {
  const w = decodeBlob<InviteWire>(blob);
  return {
    familyId: w.i,
    familyName: w.f,
    parentAddress: w.p,
    kidName: w.k,
    // Board fields are optional; an old link simply omits `b`/`y` → undefined,
    // and the joiner falls back to unsynced (see joinFamily / use-family-board).
    ...(w.b ? { boardId: w.b } : {}),
    ...(w.y ? { familyKey: w.y } : {}),
    // Destructure defensively — older links won't have the trailing elements,
    // so note/assignee/rep are simply `undefined` there.
    chores: (w.c ?? []).map(([id, name, emoji, rewardXlm, note, assignee, rep]) => ({
      id,
      name,
      emoji,
      rewardXlm,
      ...(note ? { note } : {}),
      ...(assignee ? { assignee } : {}),
      ...(rep === "w"
        ? { repeat: "weekly" as const }
        : rep === "o"
          ? { repeat: "once" as const }
          : {}),
    })),
  };
}

export function buildInviteLink(payload: InvitePayload, origin?: string): string {
  const base =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/join#invite=${encodeInvite(payload)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Claim link — parent → kid: one reward note, so the kid can import + claim.
//    URL shape:  <origin>/claim-link#claim=<blob>
//
//  SECURITY NOTE (demo-grade): the note's `secret` is the ENTIRE security of the
//  reward — anyone who sees this link can claim the XLM. That is acceptable for
//  this hackathon demo (the parent hands the link to their own kid), but it must
//  NOT be treated as production-safe. The consuming screen strips the hash from
//  the URL after import so the secret doesn't linger in the address bar/history.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaimLinkPayload {
  /** Decimal-string bigint secret (serialized carefully — never a JS number). */
  secret: string;
  /** Reward size in stroops (decimal-string bigint). */
  amountStroops: string;
  /** Leaf index the commitment was inserted at (from deposit). */
  leafIndex: number;
  /** Optional human label. */
  label?: string;
}

/** Short-key wire form for the claim link. */
interface ClaimWire {
  s: string; // secret
  a: string; // amountStroops
  l: number; // leafIndex
  n?: string; // label (note)
}

export function encodeClaimLinkPayload(p: ClaimLinkPayload): string {
  const wire: ClaimWire = { s: p.secret, a: p.amountStroops, l: p.leafIndex };
  if (p.label) wire.n = p.label;
  return encodeBlob(wire);
}

export function decodeClaimLinkPayload(blob: string): ClaimLinkPayload {
  const w = decodeBlob<ClaimWire>(blob);
  return {
    secret: w.s,
    amountStroops: w.a,
    leafIndex: w.l,
    label: w.n,
  };
}

/** Build a claim link from a stored ClaimNote. */
export function buildClaimLink(note: ClaimNote, origin?: string): string {
  const base =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const blob = encodeClaimLinkPayload({
    secret: note.secret,
    amountStroops: note.amountStroops,
    leafIndex: note.leafIndex,
    label: note.label,
  });
  return `${base}/claim-link#claim=${blob}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Claim-link import — write the note into the SAME localStorage shape
//  use-rewards reads (NOTES_STORAGE_KEY, ClaimNote[]). We derive the note id
//  (hex nullifier) so it dedupes exactly like use-rewards' fund path.
// ─────────────────────────────────────────────────────────────────────────────

/** Build a ClaimNote from a decoded claim-link payload. */
export function noteFromClaimLink(
  p: ClaimLinkPayload,
  deriveId: (secret: bigint, amountStroops: bigint) => string,
): ClaimNote {
  return {
    id: deriveId(BigInt(p.secret), BigInt(p.amountStroops)),
    secret: p.secret,
    amountStroops: p.amountStroops,
    leafIndex: p.leafIndex,
    createdAt: Date.now(),
    label: p.label,
  };
}

/**
 * Import a note into use-rewards' localStorage (dedupe by id). Returns true if a
 * new note was written, false if it was already present. React-side callers
 * should emit the same-tab notes-changed event afterwards.
 */
export function importNote(note: ClaimNote): boolean {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    const existing: ClaimNote[] = raw ? (JSON.parse(raw) as ClaimNote[]) : [];
    const list = Array.isArray(existing) ? existing : [];
    if (list.some((n) => n.id === note.id)) return false;
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify([...list, note]));
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hash-param helpers — read a `#key=value` fragment param, then strip it.
// ─────────────────────────────────────────────────────────────────────────────

/** Read a single hash param (e.g. "invite" from "#invite=xyz"). */
export function readHashParam(key: string, hash?: string): string | null {
  const h = (hash ?? (typeof window !== "undefined" ? window.location.hash : "")).replace(
    /^#/,
    "",
  );
  if (!h) return null;
  for (const part of h.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === key) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Kid → Stellar address map (local). Lets an allowance drip to a named kid
//  instead of a raw G-address. A sync layer will auto-fill this later; for now
//  it's populated the first time a parent pastes a kid's address.
//    Shape: { [kidName]: "G..." }
// ─────────────────────────────────────────────────────────────────────────────

export const KID_ADDRESSES_STORAGE_KEY = "maestro.kid-addresses.v1";
export const KID_ADDRESSES_EVENT = "maestro:kid-addresses-changed";

export type KidAddressMap = Record<string, string>;

export function loadKidAddresses(): KidAddressMap {
  try {
    const raw = localStorage.getItem(KID_ADDRESSES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as KidAddressMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** The known address for a kid, or null if we've never been told it. */
export function getKidAddress(kidName: string): string | null {
  const name = kidName.trim();
  if (!name) return null;
  return loadKidAddresses()[name] ?? null;
}

/**
 * Remember a kid's address for next time (trimmed). No-op on an empty name or
 * address. Emits a same-tab change event so open pickers refresh.
 */
export function setKidAddress(kidName: string, address: string): void {
  const name = kidName.trim();
  const addr = address.trim();
  if (!name || !addr) return;
  try {
    const next = { ...loadKidAddresses(), [name]: addr };
    localStorage.setItem(KID_ADDRESSES_STORAGE_KEY, JSON.stringify(next));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(KID_ADDRESSES_EVENT));
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Family feed store — the warm, attributable "our family" activity (audit 11).
//  Two sources fuse here:
//    • BOARD NOTICES — synced, signed, cross-device (kid-joined, reward-ready…),
//      cached locally by use-family-board so the feed renders offline too.
//    • LOCAL NOTES   — this device's own little log entries (a chore approved,
//      a reward sent), attributable to "you" without needing the board.
//  Both are plain {id, at, kind, text, kidName} rows the feed sorts newest-first.
//  This is distinct from the treasury (chain) feed, which moves to /me.
// ─────────────────────────────────────────────────────────────────────────────

/** Cached board notices (mirror of the verified board's notices), for the feed. */
export const BOARD_NOTICES_STORAGE_KEY = "maestro.board-notices.v1";
/** This device's own local feed notes (never board-synced; per-device). */
export const LOCAL_NOTES_STORAGE_KEY = "maestro.local-notes.v1";
export const FEED_EVENT = "maestro:feed-changed";
const LOCAL_NOTES_CAP = 100;

/** A row in the family feed. `kind` mirrors the board notice kinds plus locals. */
export interface FeedEntry {
  id: string;
  at: number;
  kind: "kid-joined" | "reward-ready" | "allowance-started" | "message" | "note";
  kidName?: string;
  text?: string;
}

/** Replace the cached board notices (called by the sync hook after each merge). */
export function saveBoardNotices(notices: FeedEntry[]): void {
  try {
    localStorage.setItem(BOARD_NOTICES_STORAGE_KEY, JSON.stringify(notices));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(FEED_EVENT));
  } catch {
    /* ignore */
  }
}

export function loadBoardNotices(): FeedEntry[] {
  try {
    const raw = localStorage.getItem(BOARD_NOTICES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FeedEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadLocalNotes(): FeedEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_NOTES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FeedEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Append one local (this-device) feed note. Capped, newest last, event-emitting. */
export function recordLocalNote(entry: Omit<FeedEntry, "id" | "at"> & { id?: string; at?: number }): void {
  try {
    const row: FeedEntry = {
      id: entry.id ?? randomId(),
      at: entry.at ?? Date.now(),
      kind: entry.kind,
      ...(entry.kidName ? { kidName: entry.kidName } : {}),
      ...(entry.text ? { text: entry.text } : {}),
    };
    const log = loadLocalNotes();
    log.push(row);
    const capped = log.length > LOCAL_NOTES_CAP ? log.slice(log.length - LOCAL_NOTES_CAP) : log;
    localStorage.setItem(LOCAL_NOTES_STORAGE_KEY, JSON.stringify(capped));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(FEED_EVENT));
  } catch {
    /* ignore */
  }
}

/** The merged family feed: board notices + local notes, id-deduped, newest-first. */
export function loadFamilyFeed(): FeedEntry[] {
  const seen = new Set<string>();
  const out: FeedEntry[] = [];
  for (const e of [...loadBoardNotices(), ...loadLocalNotes()]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

/**
 * Strip the hash from the current URL without a navigation/reload — so a
 * sensitive claim secret doesn't linger in the address bar or history entry.
 */
export function stripHash(): void {
  if (typeof window === "undefined") return;
  try {
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  } catch {
    /* ignore */
  }
}
