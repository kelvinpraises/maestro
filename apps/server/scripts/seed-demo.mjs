#!/usr/bin/env node
// Seed a demo family board through the relay's public HTTP contract.
//
// The relay stores opaque blobs: PUT /board/:id {version, blob} where
// blob = base64url(12-byte nonce ‖ AES-GCM ciphertext of the Board JSON).
// This script reproduces the client's exact format (apps/client/src/lib/board.ts)
// so the seeded board opens in the browser once localStorage holds the printed
// familyId + key.
//
// Usage:
//   node scripts/seed-demo.mjs [--url http://localhost:8787] [--family-id ID] [--key KEY]
//
// Prints the localStorage snippet to paste in the browser console.

import { webcrypto as crypto } from 'node:crypto'

const args = process.argv.slice(2)
function arg(name, fallback) {
	const i = args.indexOf(name)
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const BASE = arg('--url', 'http://localhost:8787')

const enc = new TextEncoder()
const b64url = (bytes) =>
	Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlDecode = (s) =>
	Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64')
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))

async function encrypt(key, value) {
	const nonce = randomBytes(12)
	const ct = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, enc.encode(JSON.stringify(value))),
	)
	const out = new Uint8Array(nonce.length + ct.length)
	out.set(nonce)
	out.set(ct, nonce.length)
	return b64url(out)
}

async function decrypt(key, blob) {
	const packed = b64urlDecode(blob)
	const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12))
	return JSON.parse(new TextDecoder().decode(pt))
}

const importKey = async (rawB64) => crypto.subtle.importKey('raw', b64urlDecode(rawB64), 'AES-GCM', false, ['encrypt', 'decrypt'])

// ── deterministic demo identities (stable across runs so re-seeding is safe) ──
const FAMILY_ID = arg('--family-id', 'ZGVtbwAAAAAAAAAAAAAAAAAAAA') // base64url of 16 bytes "demo" + zeros
// Deterministic demo key so re-runs merge into the same family instead of
// losing the GCM key. Override with --key if you want a private one.
const KEY_B64 = arg('--key', 'TUFFU1RSTy1ERU1PLUtFWS0wMDAwMDAwMDAwMDAwAAA')
if (Buffer.from(b64urlDecode(KEY_B64)).length !== 32) {
	console.error('--key must decode to exactly 32 bytes (AES-256)')
	process.exit(1)
}

// Placeholders are fine for kids' stash addresses on camera; claims are
// permissionless and nothing here moves real funds.
const KID1 = '0x51b000000000000000000000000000000000000000000000001'
const KID2 = '0x51b000000000000000000000000000000000000000000000002'
const STRK = (whole) => BigInt(whole) * 10n ** 18n // whole STRK → raw units

const board = {
	chores: [
		{ id: 'c1', title: 'Walk the dog', reward: STRK(2).toString(), state: 'approved' },
		{ id: 'c2', title: 'Water the plants', reward: STRK(3).toString(), state: 'todo' },
		{ id: 'c3', title: 'Clean your room', reward: STRK(5).toString(), state: 'pending' },
	],
	approvals: [{ id: 'a1', choreId: 'c1', at: new Date(Date.now() - 36e5).toISOString() }],
	notices: [{ id: 'n1', text: 'Welcome to the Maestro demo family!', at: new Date().toISOString() }],
	members: [
		{ name: 'Mom', role: 'parent', address: '0xpa...rent' },
		{ name: 'Ava', role: 'kid', address: KID1 },
		{ name: 'Ben', role: 'kid', address: KID2 },
	],
	streams: [
		{
			id: 's1',
			recipients: [
				{ address: KID1, share: '7' },
				{ address: KID2, share: '3' },
			],
			amount: STRK(101).toString(),
			ratePerSec: '10',
			openedAt: new Date().toISOString(),
		},
	],
	goals: [
		{ kidAddress: KID1, title: 'New skateboard', targetAmount: STRK(50).toString(), createdAt: new Date().toISOString() },
	],
	streaks: [{ kidAddress: KID1, lastDay: new Date().toISOString().slice(0, 10), count: 4 }],
}

// ── read-modify-write against the relay, mirroring the client's save() ────────
const url = `${BASE}/board/${encodeURIComponent(FAMILY_ID)}`
const key = await importKey(KEY_B64)

let version = 0
let current = null
const getRes = await fetch(url)
if (getRes.status === 200) {
	current = await getRes.json()
	version = current.version
} else if (getRes.status !== 404) {
	console.error(`relay GET failed: ${getRes.status}`)
	process.exit(1)
}

let blob
if (current) {
	// Family exists — merge onto what's there so we never clobber live data.
	let existing
	try {
		existing = await decrypt(key, current.blob)
	} catch {
		console.error(
			`family ${FAMILY_ID} exists but this key can't decrypt it — pass --key <original> or pick another --family-id`,
		)
		process.exit(1)
	}
	existing.members = board.members
	existing.goals = board.goals ?? existing.goals
	existing.streams = board.streams
	existing.chores.push(...board.chores.filter((c) => !existing.chores.some((x) => x.id === c.id)))
	blob = await encrypt(key, existing)
	version += 1
} else {
	blob = await encrypt(key, { ...board, approvals: board.approvals, notices: board.notices })
	version = 1
}

const putRes = await fetch(url, {
	method: 'PUT',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ version, blob }),
})
if (!putRes.ok) {
	console.error(`relay PUT failed: ${putRes.status} ${await putRes.text()}`)
	process.exit(1)
}

console.log(`\nSeeded family ${FAMILY_ID} at ${BASE}/board/${FAMILY_ID} (version ${version})`)
console.log('\nPaste this in the browser console (on the app origin), then reload:\n')
console.log(`localStorage.setItem('maestro.board.familyId', '${FAMILY_ID}')`)
console.log(`localStorage.setItem('maestro.board.key', '${KEY_B64}')`)
console.log("location.href='/chores'; location.reload()\n")
