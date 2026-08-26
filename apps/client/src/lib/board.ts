// Encrypted family-board sync against the relay (apps/server).
//
// Contract: GET /board/:familyId → {version,blob} | 404; PUT {version,blob}
// accepted only at exactly current+1, else 409 with the server's current record.
// The blob is base64url(nonce ‖ AES-GCM ciphertext) — fresh 96-bit nonce per
// encryption, never reused. The relay stores opaque bytes; familyId is the only
// "auth", the key never leaves localStorage.

export type FamilyRole = 'parent' | 'kid'

export interface Chore {
  id: string
  title: string
  /** Reward in STRK smallest units (felt string). */
  reward: string
  /** todo → pending (kid claimed) → paying (payout firing) → approved (paid). */
  state: 'todo' | 'pending' | 'paying' | 'approved'
}

export interface Member {
  name: string
  role: FamilyRole
  /** Kid: the stash address rewards are privately transferred to. */
  address: string
}

export interface Board {
  chores: Chore[]
  approvals: Array<{ id: string; choreId: string; at: string; txHash?: string }>
  notices: Array<{ id: string; text: string; at: string }>
  /** Board v2. Absent in v1 blobs — normalized to []. */
  members?: Member[]
}

export const EMPTY_BOARD: Board = { chores: [], approvals: [], notices: [], members: [] } // treat as immutable


const FAMILY_KEY = 'maestro.board.key'
const FAMILY_ID = 'maestro.board.familyId'

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0))
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** Family id = random 128-bit capability, minted alongside the key. */
export function mintFamily(): { familyId: string; rawKey: string } {
  return {
    familyId: b64urlEncode(randomBytes(16)),
    rawKey: b64urlEncode(randomBytes(32)),
  }
}

/** First parent open: generate and persist key+familyId in localStorage. */
export function ensureFamily(storage: Storage = localStorage): { familyId: string; rawKey: string } {
  const existingId = storage.getItem(FAMILY_ID)
  const existingKey = storage.getItem(FAMILY_KEY)
  if (existingId && existingKey) return { familyId: existingId, rawKey: existingKey }
  const fam = mintFamily()
  storage.setItem(FAMILY_ID, fam.familyId)
  storage.setItem(FAMILY_KEY, fam.rawKey)
  return fam
}

/** Import stored key material as an AES-GCM CryptoKey. Throws on garbage input. */
export async function importKey(rawKeyB64url: string): Promise<CryptoKey> {
  const raw = b64urlDecode(rawKeyB64url)
  if (raw.byteLength !== 32) throw new Error('family key must be 32 bytes')
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** Encrypt JSON to base64url(nonce ‖ ciphertext). New nonce every call — never reused. */
export async function encrypt(key: CryptoKey, value: unknown): Promise<string> {
  const nonce = randomBytes(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, enc.encode(JSON.stringify(value))))
  const out = new Uint8Array(nonce.length + ct.length)
  out.set(nonce)
  out.set(ct, nonce.length)
  return b64urlEncode(out)
}

/** Decrypt base64url(nonce ‖ ciphertext); GCM auth failure throws on tamper. */
export async function decrypt(key: CryptoKey, blob: string): Promise<unknown> {
  const packed = b64urlDecode(blob)
  const nonce = packed.slice(0, 12)
  const ct = packed.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, ct as BufferSource)
  return JSON.parse(dec.decode(pt))
}

type FetchLike = typeof globalThis.fetch

/**
 * Pull the board. 404 ⇒ empty v1 board (first ever open). Tamper or bad JSON
 * throws — corrupt data is never rendered as a board.
 */
export async function load(
  baseUrl: string,
  familyId: string,
  key: CryptoKey,
  doFetch: FetchLike = globalThis.fetch,
): Promise<Board> {
  const res = await doFetch(`${baseUrl}/board/${familyId}`)
  if (res.status === 404) return { ...EMPTY_BOARD }
  if (!res.ok) throw new Error(`relay GET failed: ${res.status}`)
  const rec = (await res.json()) as { version: number; blob: string }
  return validateShape(await decrypt(key, rec.blob))
}

function validateShape(v: unknown): Board {
  if (typeof v !== 'object' || v === null || !('chores' in v) || !('approvals' in v) || !('notices' in v)) {
    throw new Error('board blob has wrong shape')
  }
  const board = v as Board
  // v1 blobs predate members and per-chore state — normalize forward.
  board.members ??= []
  for (const c of board.chores) {
    ;(c as Chore).reward ??= '0'
    ;(c as Chore).state ??= 'todo'
  }
  return board
}

/**
 * Read-modify-write with optimistic concurrency: GET → decrypt → apply mutator
 * → encrypt (fresh nonce) → PUT at currentVersion+1. On 409 the server returns
 * its current record; we re-pull from THAT, re-apply the mutator, retry ONCE.
 * A second clash or any mutator throw aborts without writing.
 */
export async function save(
  baseUrl: string,
  familyId: string,
  key: CryptoKey,
  mutator: (board: Board) => void,
  doFetch: FetchLike = globalThis.fetch,
): Promise<{ version: number; board: Board }> {
  let attempt = 0
  // Loop is bounded by the retry-once rule: max two passes.
  while (true) {
    attempt++
    const pulled = await loadRaw(baseUrl, familyId, key, doFetch)
    const board = pulled?.board ?? { ...EMPTY_BOARD }
    mutator(board) // mutator throw here aborts before any write
    const version = (pulled?.version ?? 0) + 1
    const body = JSON.stringify({ version, blob: await encrypt(key, board) })
    const res = await doFetch(`${baseUrl}/board/${familyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (res.ok) return { version, board }
    if (res.status === 409 && attempt < 2) continue // re-pull, re-apply, retry once
    throw new Error(`relay PUT failed: ${res.status}${attempt > 1 ? ' after one conflict-retry' : ''}`)
  }
}

async function loadRaw(baseUrl: string, familyId: string, key: CryptoKey, doFetch: FetchLike) {
  const res = await doFetch(`${baseUrl}/board/${familyId}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`relay GET failed: ${res.status}`)
  const rec = (await res.json()) as { version: number; blob: string }
  return { version: rec.version, board: validateShape(await decrypt(key, rec.blob)) }
}
