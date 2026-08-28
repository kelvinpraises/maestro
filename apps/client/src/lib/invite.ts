// Invite links — port of maestro-redacted lib/family invite codec, adapted to
// our encrypted-board model. The link rides familyId + familyKey (the AES-GCM
// key) + family name + kid name, so a kid device lands fully provisioned:
// board synced, name known, chores visible, one tap.
//
// SECURITY (demo-grade, same caveat as redacted): the family key IS in the
// link. Anyone who sees it reads the board. Acceptable parent→own-kid
// handoff; the join screen strips the hash after import.

export interface InvitePayload {
  familyId: string
  familyName: string
  familyKey: string // raw AES-GCM key (base64url)
  kidName: string
}

interface InviteWire {
  i: string // familyId
  f: string // familyName
  y: string // familyKey
  k: string // kidName
}

// base64url helpers (no deps — mirrors onboarding.ts codec style)
function b64urlEncode(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function encodeInvite(p: InvitePayload): string {
  const wire: InviteWire = { i: p.familyId, f: p.familyName, y: p.familyKey, k: p.kidName }
  const json = JSON.stringify(wire)
  return b64urlEncode(new TextEncoder().encode(json))
}

export function decodeInvite(blob: string): InvitePayload | { error: string } {
  try {
    const json = new TextDecoder().decode(b64urlDecode(blob))
    const w = JSON.parse(json) as Partial<InviteWire>
    if (!w.i || !w.f || !w.y || !w.k) return { error: 'invite is missing fields' }
    return { familyId: w.i, familyName: w.f, familyKey: w.y, kidName: w.k }
  } catch {
    return { error: 'invite link is malformed' }
  }
}

export function buildInviteLink(p: InvitePayload, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/join#invite=${encodeInvite(p)}`
}

/** Read + strip the #invite= fragment (strips so it never lingers in history). */
export function readAndStripInvite(): string | null {
  if (typeof window === 'undefined') return null
  const h = window.location.hash
  const m = h.match(/#invite=([A-Za-z0-9\-_]+)/)
  if (!m) return null
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return m[1]
}
