// board.ts — the encrypted family board: crypto (AES-GCM), signed sections
// (Stellar ed25519), and a pure merge. React-free so it runs under tsx/node too.
//
// Two independent guarantees stack here:
//
//   1. CONFIDENTIALITY (family key). The whole board JSON is AES-GCM encrypted
//      with a symmetric key generated at family creation and carried on the
//      invite link. The relay server stores only ciphertext — it can't read a
//      byte. Family members are mutually trusted (any family device can decrypt),
//      which is the stated trade-off (FAMILY-BOARD.md): right for a family
//      product, per-kid boxing is the v2 hardening.
//
//   2. AUTHENTICITY (per-device signatures). Confidentiality alone doesn't say
//      WHO wrote a section — anyone with the family key could forge a chore or a
//      kid's "done". So every writable section is signed by its author's Stellar
//      ed25519 key and verified against a PUBLISHED address at merge time:
//        • family / chores          → parent (family.parentAddress)
//        • kids[name] entry         → that kid's own address (TOFU: a kid's first
//                                     join write introduces their address; from
//                                     then on their state writes verify against
//                                     it)
//        • states[choreId][name]    → that kid's address
//        • notices[i]               → the notice's declared author address, which
//                                     must be the parent OR a known kid
//
// The merge is pure and deterministic: parent-authoritative sections win from the
// parent, per-kid entries win from that kid, notices are append-only by id. A
// section whose signature doesn't verify is simply dropped (fail-closed).

import { Keypair } from "@stellar/stellar-sdk";
import type {
  Chore,
  ChoreStates,
  ChoreStateEntry,
  ClaimLinkPayload,
} from "@/lib/family";
import { encodeBlob, decodeBlob } from "@/lib/family";

// ─────────────────────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────────────────────

/** Board server base URL. Overridable via VITE_BOARD_URL for a deployed relay. */
export const BOARD_SERVER_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_BOARD_URL) ||
  "http://localhost:8787";

/** Notices are append-only; cap the tail so a long-lived board can't grow forever. */
export const NOTICES_CAP = 200;

// ─────────────────────────────────────────────────────────────────────────────
//  Types — the decrypted board shape
// ─────────────────────────────────────────────────────────────────────────────

/** A signed section: the JSON payload, plus a signature over its canonical bytes
 *  and the signer's Stellar address so verification can pick the right key. */
export interface Signed<T> {
  payload: T;
  /** base64url ed25519 signature over canonicalBytes(payload). */
  sig: string;
  /** Signer's Stellar public key ("G…"). */
  signer: string;
}

/** Parent-owned family header. */
export interface BoardFamily {
  name: string;
  parentAddress: string;
}

/** A kid's published presence. `address` lets the allowance picker pay them. */
export interface BoardKid {
  address?: string;
  joinedAt: number;
}

/**
 * A board notice. The kinds:
 *   • kid-joined        — {kidName}
 *   • reward-ready      — {kidName=forKid, amountXlm, label?, choreId?, claim} —
 *                         the claim payload rides the (already-encrypted) board so
 *                         the kid device can AUTO-IMPORT the reward with no link.
 *   • allowance-started — {kidName=forKid, rateXlm, period}
 *   • chore-added       — {text=name, emoji?, kidName?=assignee}
 *   • chore-pending     — {kidName=doer, text=chore name, choreId} — a kid marked
 *                         a chore done; addressed to the parent (bell + feed), so
 *                         the nod is news, not only a card the parent must notice.
 *   • message           — {text, from(=author's role/name via kidName?)}
 * The base fields are common; the kind-specific ones are optional so an older or
 * unrelated notice still decodes. `claim` is the ONLY place a secret rides the
 * board; the board blob is AES-GCM encrypted (family key), which is the transport
 * security here (FAMILY-BOARD.md's stated trade-off).
 */
export interface BoardNotice {
  /** Stable id (dedupes appends across devices). */
  id: string;
  /** Unix ms. */
  at: number;
  /** Notice kind. */
  kind:
    | "kid-joined"
    | "reward-ready"
    | "allowance-started"
    | "chore-added"
    | "chore-pending"
    | "message";
  /** Who it concerns / who authored it (kid name where relevant, or a message's sender). */
  kidName?: string;
  /** Free-form human text (message notices, a chore-added/chore-pending chore name). */
  text?: string;
  /** A single emoji (chore-added). */
  emoji?: string;
  /** Reward size in XLM (reward-ready) — for warm display without decoding `claim`. */
  amountXlm?: number;
  /** Human label for the reward (reward-ready). */
  label?: string;
  /** The chore this concerns (reward-ready, chore-pending) — dedupes the feed row. */
  choreId?: string;
  /** The claim-link payload (reward-ready). The kid device auto-imports this. */
  claim?: ClaimLinkPayload;
  /** Allowance rate in XLM per period (allowance-started). */
  rateXlm?: number;
  /** Allowance period ("day" | "week") (allowance-started). */
  period?: string;
  /** Author's Stellar address (must be the parent or a known kid). */
  author: string;
}

/**
 * The decrypted board. Every writable section is wrapped in `Signed<>` so the
 * merge can verify authorship. `states` uses the family model's exact v2 shape
 * ({ [choreId]: { [kidName]: {state, at} } }), keyed one signed entry per
 * (chore, kid) so each kid signs only their own progress.
 */
export interface Board {
  v: 1;
  /** Parent-signed family header. */
  family: Signed<BoardFamily>;
  /** Parent-signed chore list. */
  chores: Signed<Chore[]>;
  /** Per-kid presence; each entry signed by that kid (TOFU on first write). */
  kids: Record<string, Signed<BoardKid>>;
  /** Per-(chore,kid) state; each signed by that kid. Keyed "choreId::kidName". */
  states: Record<string, Signed<{ choreId: string; kidName: string; entry: ChoreStateEntry }>>;
  /** Append-only notices; each signed by its author. */
  notices: Signed<BoardNotice>[];
}

/** An empty board a parent seeds at family creation (before any encryption). */
export function emptyBoard(): Omit<Board, "family" | "chores"> & {
  family?: undefined;
  chores?: undefined;
} {
  return { v: 1, kids: {}, states: {}, notices: [], family: undefined, chores: undefined };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Canonical bytes — deterministic serialization for signing/verifying
// ─────────────────────────────────────────────────────────────────────────────

/** Recursively sort object keys so two logically-equal payloads serialize
 *  identically regardless of key insertion order (stable signatures). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function canonicalBytes(payload: unknown): Uint8Array {
  return utf8(JSON.stringify(canonicalize(payload)));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Signing / verifying (Stellar ed25519 via stellar-sdk Keypair)
// ─────────────────────────────────────────────────────────────────────────────

/** Sign a section payload with a Stellar keypair, returning a Signed envelope. */
export function signSection<T>(payload: T, keypair: Keypair): Signed<T> {
  const sig = keypair.sign(Buffer.from(canonicalBytes(payload)));
  return {
    payload,
    sig: bytesToB64url(new Uint8Array(sig)),
    signer: keypair.publicKey(),
  };
}

/**
 * Verify a Signed envelope. Returns the payload iff the signature is valid AND
 * the signer matches `expectedSigner` (when given). Any failure returns null so
 * callers fail closed (drop the section). Never throws.
 */
export function verifySection<T>(
  signed: Signed<T> | undefined,
  expectedSigner?: string,
): T | null {
  if (!signed || typeof signed.sig !== "string" || typeof signed.signer !== "string") {
    return null;
  }
  if (expectedSigner && signed.signer !== expectedSigner) return null;
  try {
    const kp = Keypair.fromPublicKey(signed.signer);
    const ok = kp.verify(
      Buffer.from(canonicalBytes(signed.payload)),
      Buffer.from(b64urlToBytes(signed.sig)),
    );
    return ok ? signed.payload : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  AES-GCM family-key encryption (WebCrypto; works in browser + node 22)
// ─────────────────────────────────────────────────────────────────────────────

const subtle = (): SubtleCrypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("WebCrypto SubtleCrypto is unavailable");
  return c.subtle;
};

/** Copy bytes into a fresh, plain ArrayBuffer so WebCrypto's BufferSource typing
 *  (which rejects the SharedArrayBuffer-possible ArrayBufferLike) is satisfied. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/** Generate a fresh 256-bit AES-GCM family key, exported as a base64url string
 *  compact enough to ride the invite link. */
export async function generateFamilyKey(): Promise<string> {
  const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = new Uint8Array(await subtle().exportKey("raw", key));
  return bytesToB64url(raw);
}

async function importKey(familyKey: string): Promise<CryptoKey> {
  const raw = b64urlToBytes(familyKey);
  return subtle().importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a board with the family key → a base64url blob (12-byte IV ‖ ciphertext).
 * The IV is random per encryption; GCM binds an auth tag so tampering fails on
 * decrypt.
 */
export async function encryptBoard(board: Board, familyKey: string): Promise<string> {
  const key = await importKey(familyKey);
  const iv = (globalThis.crypto as Crypto).getRandomValues(new Uint8Array(12));
  const plaintext = utf8(JSON.stringify(board));
  const ct = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return bytesToB64url(packed);
}

/**
 * Decrypt a board blob with the family key. Throws (fails closed) on a wrong key,
 * a truncated blob, or any tampering (GCM auth-tag mismatch). Callers treat a
 * throw as "unreadable — keep local state".
 */
export async function decryptBoard(blob: string, familyKey: string): Promise<Board> {
  const key = await importKey(familyKey);
  const packed = b64urlToBytes(blob);
  if (packed.length < 13) throw new Error("board blob too short");
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const plaintext = new Uint8Array(
    await subtle().decrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(ct)),
  );
  const board = JSON.parse(bytesToUtf8(plaintext)) as Board;
  if (!board || board.v !== 1) throw new Error("unexpected board version");
  return board;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Merge — pure, deterministic, fail-closed
// ─────────────────────────────────────────────────────────────────────────────

/** The state key convention: one signed state entry per (chore, kid). */
export function stateKey(choreId: string, kidName: string): string {
  return `${choreId}::${kidName}`;
}

/**
 * The trusted, verified view of a board after checking every signature against
 * the published addresses. Sections that fail verification are dropped. This is
 * what the sync hook merges INTO the local stores.
 */
export interface VerifiedBoard {
  family: BoardFamily | null;
  chores: Chore[];
  /** kidName → verified presence (only kids whose entry self-verifies). */
  kids: Record<string, BoardKid>;
  /** Rebuilt v2 states map: { [choreId]: { [kidName]: entry } } (verified only). */
  states: ChoreStates;
  /** Verified, id-deduped, at-sorted notices. */
  notices: BoardNotice[];
}

/**
 * Verify a decrypted board into a trusted view. `parentAddress` is the root of
 * trust for parent sections; kid sections/states verify against the address each
 * kid PUBLISHED in `board.kids` (trust-on-first-use). A kid with no published
 * address yet can't have verified states (there's no key to check against),
 * which is correct — their first write is the join that publishes the address.
 */
export function verifyBoard(board: Board, parentAddress: string): VerifiedBoard {
  // Parent-authoritative sections.
  const family = verifySection(board.family, parentAddress);
  const chores = verifySection(board.chores, parentAddress) ?? [];

  // Kid presence: each entry must be signed by the address it publishes (TOFU).
  const kids: Record<string, BoardKid> = {};
  const kidAddress: Record<string, string> = {};
  for (const [kidName, signed] of Object.entries(board.kids ?? {})) {
    // The signer IS the address being introduced — verify the entry against its
    // own declared signer (self-certifying first write).
    const payload = verifySection(signed, signed?.signer);
    if (payload && signed) {
      kids[kidName] = payload;
      if (payload.address) kidAddress[kidName] = payload.address;
      else kidAddress[kidName] = signed.signer; // presence without a stated addr
    }
  }

  // Per-(chore,kid) states: each verified against that kid's published address.
  const states: ChoreStates = {};
  for (const signed of Object.values(board.states ?? {})) {
    const addr = signed ? kidAddress[signed.payload?.kidName] : undefined;
    if (!addr) continue; // no known key for this kid → can't trust → drop
    const payload = verifySection(signed, addr);
    if (!payload) continue;
    const { choreId, kidName, entry } = payload;
    (states[choreId] ??= {})[kidName] = entry;
  }

  // Notices: author must be the parent or a known kid; id-deduped, newest-first.
  const knownAuthors = new Set<string>([parentAddress, ...Object.values(kidAddress)]);
  const seen = new Set<string>();
  const notices: BoardNotice[] = [];
  for (const signed of board.notices ?? []) {
    // Verify against the section's signer, then require the declared author to be
    // that same signer AND a known author (parent or a published kid).
    const payload = verifySection(signed, signed?.signer);
    if (!payload) continue;
    if (payload.author !== signed.signer) continue;
    if (!knownAuthors.has(payload.author)) continue;
    if (seen.has(payload.id)) continue;
    seen.add(payload.id);
    notices.push(payload);
  }
  notices.sort((a, b) => b.at - a.at);

  return { family, chores, kids, states, notices };
}

// ─────────────────────────────────────────────────────────────────────────────
//  base64url byte codecs (shared style with lib/family; bytes not JSON here)
// ─────────────────────────────────────────────────────────────────────────────

function utf8(s: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  return Uint8Array.from(Buffer.from(s, "utf-8"));
}
function bytesToUtf8(b: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
  return Buffer.from(b).toString("utf-8");
}

export function bytesToB64url(bytes: Uint8Array): string {
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

export function b64urlToBytes(u: string): Uint8Array {
  const b64 = u.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const padded = b64 + pad;
  if (typeof atob === "function") {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

// Re-export the JSON blob codecs some callers reach for alongside these.
export { encodeBlob, decodeBlob };
