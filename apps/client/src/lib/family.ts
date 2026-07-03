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
}

/** A kid's local state for a chore (per kid device). */
export type ChoreState = "todo" | "pending" | "done";

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
}

// ─────────────────────────────────────────────────────────────────────────────
//  localStorage
// ─────────────────────────────────────────────────────────────────────────────

export const FAMILY_STORAGE_KEY = "maestro.family.v1";
/** Per-kid chore states: { [choreId]: ChoreState }. */
export const CHORE_STATE_STORAGE_KEY = "maestro.chore-states.v1";

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

export function loadChoreStates(): Record<string, ChoreState> {
  try {
    const raw = localStorage.getItem(CHORE_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ChoreState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveChoreStates(states: Record<string, ChoreState>): void {
  try {
    localStorage.setItem(CHORE_STATE_STORAGE_KEY, JSON.stringify(states));
  } catch {
    /* ignore */
  }
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
}

/**
 * Compact wire form — short keys; chores as tuples. The chore tuple is
 * [id, name, emoji, rewardXlm] with an OPTIONAL trailing `note` element:
 *   [id, name, emoji, rewardXlm]          ← old links (no note)
 *   [id, name, emoji, rewardXlm, note]    ← new links (note present)
 * The 5th element is omitted when the note is empty, so encoded links stay as
 * small as before, and decode tolerates its absence (old links keep working).
 */
type ChoreTuple =
  | [string, string, string, number]
  | [string, string, string, number, string];
interface InviteWire {
  i: string; // familyId
  f: string; // familyName
  p: string; // parentAddress
  k: string; // kidName
  c: ChoreTuple[]; // chores
}

export function encodeInvite(payload: InvitePayload): string {
  const wire: InviteWire = {
    i: payload.familyId,
    f: payload.familyName,
    p: payload.parentAddress,
    k: payload.kidName,
    c: payload.chores.map((ch): ChoreTuple => {
      const note = ch.note?.trim();
      // Omit the trailing element entirely when there's no note (keeps links
      // as compact as the old 4-tuple shape).
      return note
        ? [ch.id, ch.name, ch.emoji, ch.rewardXlm, note]
        : [ch.id, ch.name, ch.emoji, ch.rewardXlm];
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
    // Destructure the 5th element defensively — old links won't have it, so
    // `note` is simply `undefined` there.
    chores: (w.c ?? []).map(([id, name, emoji, rewardXlm, note]) => ({
      id,
      name,
      emoji,
      rewardXlm,
      ...(note ? { note } : {}),
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
