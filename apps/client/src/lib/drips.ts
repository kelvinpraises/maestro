export type { Call }
// Drips-contract wrappers. Calldata builders are pure (node-testable); executors
// go through the connected WalletAccountV6 + providerForChain (wallet's chain).
import type { WalletAccountV6, Call as SdkCall } from 'starknet'
import { providerForChain } from '#/lib/starknet'
import { approveCall, openStreamSplitCall, claimAsCall, balanceOfCall, type Call } from './drips-calls'

function u256(res: string[]): bigint {
  return BigInt(res[0]) + (BigInt(res[1] ?? '0') << 128n)
}

/** View: total accrued at time t (unix seconds). */
export async function accruedAt(provider: ReturnType<typeof providerForChain>, drips: string, t: bigint): Promise<bigint> {
  const res = await provider.callContract({ contractAddress: drips, entrypoint: 'accrued_at', calldata: [t.toString()] })
  return u256(res as unknown as string[])
}

/** Batched: STRK approve + open_stream_split in one atomic transaction. */
export async function openSplit(account: WalletAccountV6, token: string, drips: string, recipients: Array<{ address: string; share: bigint }>, ratePerSec: bigint, amount: bigint): Promise<string> {
  const { transaction_hash } = await account.execute([
    approveCall(token, drips, amount),
    openStreamSplitCall(drips, recipients, ratePerSec, amount),
  ] as unknown as SdkCall[])
  return transaction_hash
}

/** Scoop everything accrued-but-unclaimed for `who`. */
export async function scoop(account: WalletAccountV6, drips: string, who: string): Promise<string> {
  const { transaction_hash } = await account.execute(claimAsCall(drips, who))
  return transaction_hash
}

/** Combined kid balance: public STRK (balance_of on the token) + shielded pool balance. */
export async function totalBalance(account: WalletAccountV6, chainId: string, token: string): Promise<bigint> {
  const provider = providerForChain(chainId)
  const [pub, shielded] = await Promise.all([
    provider.callContract({ ...balanceOfCall(token, account.address) }),
    account.strk20Balances([token as never]),
  ])
  const public_ = u256(pub as unknown as string[])
  const priv = shielded[0] ? BigInt(shielded[0].balance) : 0n
  return public_ + priv
}
