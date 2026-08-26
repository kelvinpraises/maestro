import { useCallback, useEffect, useState } from 'react'
import { BOARD_URL } from './env'
import { importKey, load, save, type Board } from './board'

 export interface UseBoard {
  /** Board data once loaded; null before the family exists or first load completes. */
  board: Board | null
  /** Apply a mutation through the encrypted read-modify-write loop. */
  mutate: (mutator: (board: Board) => void) => Promise<void>
  syncing: boolean
  error: string | null
}

/**
 * Board state + encrypted sync for the current family (from localStorage).
 * Call `ensureFamily()`/`ensureFamilyKey()` first (dev route does this);
 * with no family in storage, board stays null and mutate is a no-op.
 */
export function useBoard(): UseBoard {
  const [board, setBoard] = useState<Board | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const rawKey = localStorage.getItem('maestro.board.key')
    const familyId = localStorage.getItem('maestro.board.familyId')
    if (!rawKey || !familyId) return // no family minted yet — nothing to load
    let cancelled = false
    setSyncing(true)
    importKey(rawKey)
      .then((key) => load(BOARD_URL, familyId, key))
      .then((b) => !cancelled && setBoard(b))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setSyncing(false))
    return () => {
      cancelled = true
    }
  }, [])

  const mutate = useCallback(async (mutator: (board: Board) => void) => {
    const familyId = localStorage.getItem('maestro.board.familyId')
    const rawKey = localStorage.getItem('maestro.board.key')
    if (!familyId || !rawKey) throw new Error('no family — create one first')
    setSyncing(true)
    setError(null)
    try {
      const key = await importKey(rawKey)
      const { board: next } = await save(BOARD_URL, familyId, key, mutator)
      setBoard(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setSyncing(false)
    }
  }, [])

  return { board, mutate, syncing, error }
}
