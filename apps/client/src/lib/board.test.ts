// Runnable check: node src/lib/board.test.ts (webcrypto + btoa/atob exist in node ≥18)
import assert from 'node:assert'
import {
  mintFamily, importKey, encrypt, decrypt, load, save, EMPTY_BOARD,
} from './board.ts'

const baseUrl = 'http://relay.test'

// ── crypto round-trip + nonce uniqueness ─────────────────────────────────────
const fam = mintFamily()
assert.equal(fam.familyId.length, 22) // 128-bit base64url
const key = await importKey(fam.rawKey)

const board1 = { chores: [{ id: 'c1', title: 'dishes', done: false }], approvals: [], notices: [] }
const blobA = await encrypt(key, board1)
const blobB = await encrypt(key, board1)
assert.deepEqual(await decrypt(key, blobA), board1)
assert.notEqual(blobA, blobB) // fresh nonce per encryption — never reused

// tampered blob must throw, not return data
const packed = Buffer.from(blobB.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
packed[packed.length - 1] ^= 0xff
const tampered = packed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
await assert.rejects(() => decrypt(key, tampered))
// wrong key also throws
const otherKey = await importKey(mintFamily().rawKey)
await assert.rejects(() => decrypt(otherKey, blobA))

// ── fake relay with versioned-blob semantics ─────────────────────────────────
function makeRelay() {
  const store: Record<string, { version: number; blob: string }> = {}
  let putLog: number[] = []
  const doFetch: typeof globalThis.fetch = async (_url, init?) => {
    const url = String(_url)
    const id = url.split('/board/')[1]!
    if (!init?.method || init.method === 'GET') {
      const rec = store[id]
      return rec
        ? new Response(JSON.stringify(rec), { status: 200 })
        : new Response(JSON.stringify({ error: 'no_board' }), { status: 404 })
    }
    const body = JSON.parse(String(init.body)) as { version: number; blob: string }
    putLog.push(body.version)
    const cur = store[id]
    if (cur && body.version !== cur.version + 1) {
      return new Response(JSON.stringify({ error: 'version_conflict', current: cur }), { status: 409 })
    }
    store[id] = { version: body.version, blob: body.blob }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  return { doFetch, versionsPushed: () => putLog }
}

// first save against empty relay: starts from EMPTY_BOARD at version 1
{
  const relay = makeRelay()
  const r = await save(baseUrl, fam.familyId, key, () => {}, relay.doFetch)
  assert.equal(r.version, 1)
  assert.deepEqual(r.board, EMPTY_BOARD)
}

// load round-trip after a save
{
  const relay = makeRelay()
  await save(baseUrl, fam.familyId, key, (b) => b.chores.push({ id: 'c2', title: 'trash', done: false }), relay.doFetch)
  const loaded = await load(baseUrl, fam.familyId, key, relay.doFetch)
  assert.equal(loaded.chores[0]!.title, 'trash')
}

{
  // Interleaving: the kid's push lands BETWEEN the parent's GET and PUT — the
  // parent therefore writes a stale version, eats exactly one 409, re-pulls,
  // re-applies its mutator on the server's current, and succeeds.
  const relay = makeRelay()
  await save(baseUrl, fam.familyId, key, (b) => b.notices.push({ id: 'n1', text: 'seed', at: 't0' }), relay.doFetch)

  const kidPush = save(baseUrl, fam.familyId, key, (b) => b.approvals.push({ id: 'a1', choreId: 'c9', at: 't1' }), relay.doFetch)
  const parentFetch: typeof globalThis.fetch = async (url, init) => {
    if (init?.method === 'PUT') await kidPush // kid lands between our GET (done) and our PUT
    return relay.doFetch(url, init)
  }

  let mutatorRuns = 0
  const r = await save(
    baseUrl, fam.familyId, key,
    (b) => {
      b.chores.push({ id: 'p1', title: 'parent chore', done: false })
      mutatorRuns++
    },
    parentFetch,
  )
  assert.equal(mutatorRuns, 2) // applied once, re-applied on retry
  assert.equal(r.version, 3)
  const final = await load(baseUrl, fam.familyId, key, relay.doFetch)
  assert.equal(final.chores.some((c) => c.id === 'p1'), true) // parent's change landed
  assert.equal(final.approvals.some((a) => a.id === 'a1'), true) // kid's change survived
  assert.equal(final.notices[0]!.id, 'n1')
}

// persistent conflict (two clashing writers) surfaces as an error, no silent loss
{
  const relay = makeRelay()
  await save(baseUrl, fam.familyId, key, () => {}, relay.doFetch)
  const hostile: typeof globalThis.fetch = async (_url, init) =>
    init?.method === 'PUT'
      ? new Response(JSON.stringify({ error: 'version_conflict', current: { version: 99, blob: '' } }), { status: 409 })
      : new Response(JSON.stringify({ version: 1, blob: await encrypt(key, EMPTY_BOARD) }), { status: 200 })
  await assert.rejects(() => save(baseUrl, fam.familyId, key, () => {}, hostile), /after one conflict-retry/)
}

// mutator throwing aborts before any PUT
{
  const relay = makeRelay()
  await save(baseUrl, fam.familyId, key, () => {}, relay.doFetch)
  const before = relay.versionsPushed().length
  await assert.rejects(() =>
    save(baseUrl, fam.familyId, key, () => {
      throw new Error('boom')
    }, relay.doFetch),
  )
  assert.equal(relay.versionsPushed().length, before) // nothing written
}

console.log('board.test: all assertions passed')
