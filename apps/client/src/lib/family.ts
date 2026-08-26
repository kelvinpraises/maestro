// Role + membership helpers shared by the Pot/Chores screens.
import type { Board, FamilyRole } from './board'

const ROLE_KEY = 'maestro.role'

export function currentRole(): FamilyRole {
  return localStorage.getItem(ROLE_KEY) === 'kid' ? 'kid' : 'parent'
}

export function setRole(role: FamilyRole): void {
  localStorage.setItem(ROLE_KEY, role)
}

/** This device's kid identity, if it joined. */
export function myKid(board: Board | null): { name: string; address: string } | null {
  if (!board?.members || currentRole() !== 'kid') return null
  return board.members.find((m) => m.role === 'kid') ?? null
}
