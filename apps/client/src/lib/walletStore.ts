import { useSyncExternalStore } from 'react'
import type { WalletAccountV6 } from 'starknet'

// Minimal external store so any route (e.g. /dev/money) can read the wallet
// state that WalletButton establishes — no context boilerplate.
export interface WalletState {
  account: WalletAccountV6 | null
  chainId: string | null
}

let state: WalletState = { account: null, chainId: null }
const listeners = new Set<() => void>()

export function setWallet(next: Partial<WalletState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useWallet(): WalletState {
  return useSyncExternalStore(subscribe, () => state)
}
