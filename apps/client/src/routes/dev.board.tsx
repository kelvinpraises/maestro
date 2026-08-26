import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ensureFamily, importKey } from '#/lib/board'
import { useBoard } from '#/lib/useBoard'
import { BOARD_URL } from "#/lib/env"

export const Route = createFileRoute('/dev/board')({ component: DevBoard })

function DevBoard() {
  if (import.meta.env.VITE_ENABLE_DEV_MONEY !== '1') {
    return <p className="p-8 text-sm text-zinc-500">Set VITE_ENABLE_DEV_MONEY=1 in .env.local to enable.</p>
  }
  return <BoardPlayground />
}

let cachedKey: CryptoKey | null = null

/** Mint-or-load the family and cache the imported key for the page session. */
async function familyKey(): Promise<{ familyId: string; key: CryptoKey }> {
  const fam = ensureFamily()
  cachedKey ??= await importKey(fam.rawKey)
  return { familyId: fam.familyId, key: cachedKey }
}

function BoardPlayground() {
  const { board, mutate, syncing, error } = useBoard()
  const [out, setOut] = useState('')
  const log = (line: string) => setOut((o) => `${o}\n${line}`)

  async function createOrShow() {
    try {
      const { familyId } = await familyKey()
      log(`family ${familyId} ready (key persisted in localStorage)`)
    } catch (e) {
      log(`ERROR: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function addChore() {
    void mutate((b) => b.chores.push({ id: crypto.randomUUID(), title: `chore ${Date.now() % 1000}`, done: false }))
      .then(() => log('chore added'))
      .catch(() => {})
  }

  function approveChore() {
    void mutate((b) => {
      const open = b.chores.find((c) => c.done && !b.approvals.some((a) => a.choreId === c.id))
      if (!open) throw new Error('no done-and-unapproved chore to approve')
      b.approvals.push({ id: crypto.randomUUID(), choreId: open.id, at: new Date().toISOString() })
    })
      .then(() => log('chore approved'))
      .catch(() => {})
  }

  return (
    <div className="max-w-2xl p-8 text-sm">
      <h1 className="mb-2 font-semibold">dev/board — encrypted sync against {BOARD_URL}</h1>
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => void createOrShow()} className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
          Create/load family
        </button>
        <button onClick={addChore} disabled={syncing} className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">
          Add chore
        </button>
        <button onClick={approveChore} disabled={syncing} className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-50 dark:border-zinc-700">
          Approve a done chore
        </button>
        <button onClick={() => setOut(JSON.stringify(board, null, 2))} className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
          Dump local board
        </button>
      </div>

      <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
        {out.trim() || '(output appears here)'}
      </pre>
    </div>
  )
}
