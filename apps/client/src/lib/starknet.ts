import { RpcProvider } from 'starknet'
import { chainName, rpcUrlForChain, strkTokenForChain } from './chains'

export { chainName }

/** RPC URL for the wallet's chain from env; null when the chain has no config. */
export function rpcUrlFor(chainId: string): string | null {
  return rpcUrlForChain(import.meta.env as Record<string, string | undefined>, chainId)
}

export function strkToken(chainId: string): string | null {
  return strkTokenForChain(import.meta.env as Record<string, string | undefined>, chainId)
}

const providers = new Map<string, RpcProvider>()

/**
 * Provider targeting the given chain — always the chain the WALLET is on,
 * never "whatever VITE_RPC_URL points at". Cached per chain.
 * Throws (visible error upstream) if a chain has no configured endpoint.
 */
export function providerForChain(chainId: string): RpcProvider {
  let p = providers.get(chainId)
  if (!p) {
    const url = rpcUrlFor(chainId)
    if (!url) throw new Error(`No RPC URL configured for chain ${chainName(chainId)} (${chainId})`)
    p = new RpcProvider({ nodeUrl: url })
    providers.set(chainId, p)
  }
  return p
}

export function trimAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
