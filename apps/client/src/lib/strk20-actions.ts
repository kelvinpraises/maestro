// Pure STRK20 action builders — type-only SDK imports (erased at runtime), testable under plain node.
import type { STRK20_ACTION } from 'starknet'

export const DEV_SHIELD_AMOUNT = '0x2386f26fc10000' // 0.01 token at 18 decimals

/** Shield: public deposit into the privacy pool. Wallet prompts twice (approve, then deposit). */
export function shieldActions(token: string, amount: string): STRK20_ACTION[] {
  return [{ type: 'deposit', token, amount }]
}

/** Unshield (withdraw): private pool balance back out to a public recipient. */
export function unshieldActions(token: string, amount: string, recipient: string): STRK20_ACTION[] {
  return [{ type: 'withdraw', token, amount, recipient }]
}

/**
 * Private transfer inside the pool — no public leg. Recipient must be a
 * registered pool user; sender is auto-registered by the wallet on first use.
 */
export function privateTransferActions(token: string, amount: string, recipient: string): STRK20_ACTION[] {
  return [{ type: 'transfer', token, amount, recipient }]
}

/**
 * Padded and unpadded hex strings can name the same address — compare via BigInt.
 */
export function sameAddress(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}
