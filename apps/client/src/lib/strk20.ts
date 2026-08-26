// SDK-bound STRK20 executors. All actions go through the connected WalletAccountV6 —
// the wallet holds keys, discovers notes, proves, and submits. We never see private state.
import type { STRK20_ACTION, WalletAccountV6 } from 'starknet'
import { providerForChain } from '#/lib/starknet'
import {
  shieldActions,
  unshieldActions,
  privateTransferActions,
} from './strk20-actions'

export { shieldActions, unshieldActions, privateTransferActions }

export interface TxResult {
  hash: string
  /** 'confirmed' | 'submitted' (timeout at our RPC — hash stays valid, keep polling) */
  status: 'confirmed' | 'submitted'
}

/**
 * Submit actions through the wallet and wait with an application timeout.
 * Per skill guidance: paymaster-relayed hashes can be slow to appear at the
 * RPC; timeout means "submitted, not yet visible", never "failed".
 */
async function submit(account: WalletAccountV6, chainId: string, actions: STRK20_ACTION[]): Promise<TxResult> {
  const { transaction_hash: hash } = await account.strk20InvokeTransaction(actions)
  try {
    await Promise.race([
      providerForChain(chainId).waitForTransaction(hash),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 60_000)),
    ])
    return { hash, status: 'confirmed' }
  } catch {
    return { hash, status: 'submitted' }
  }
}

/** Shield: public deposit into the pool. Two wallet prompts (approve + deposit) on first use per token. */
export async function shield(account: WalletAccountV6, chainId: string, token: string, amount: string) {
  return submit(account, chainId, shieldActions(token, amount))
}

/** Unshield: withdraw pool balance to a public address. */
export async function unshield(account: WalletAccountV6, chainId: string, token: string, amount: string, recipient: string) {
  return submit(account, chainId, unshieldActions(token, amount, recipient))
}

/** Private transfer inside the pool. Recipient must already be registered. */
export async function privateTransfer(account: WalletAccountV6, chainId: string, token: string, amount: string, recipient: string) {
  return submit(account, chainId, privateTransferActions(token, amount, recipient))
}

/**
 * Note discovery, as prescribed by the docs: `strk20Balances` (wallet consent
 * prompt). The Wallet API exposes no dapp-facing note-ID enumeration — note IDs
 * stay wallet-internal and are referenced via ${openNoteIds[N]} placeholders.
 * Empty array = every shielded token held.
 */
export async function shieldedBalances(account: WalletAccountV6) {
  const balances = await account.strk20Balances([])
  return balances.map((b) => ({ token: b.token, balance: BigInt(b.balance).toString() }))
}
