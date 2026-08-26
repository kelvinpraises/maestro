// Pure chain metadata — no vite/import.meta, no SDK imports. Testable under plain node.
export const SN_MAIN = '0x534e5f4d41494e'
export const SN_SEPOLIA = '0x534e5f5345504f4c4941'

const CHAIN_NAMES: Record<string, string> = {
  [SN_MAIN]: 'Mainnet',
  [SN_SEPOLIA]: 'Sepolia',
}

/** Human name for a raw chainId; falls back to the raw value for unknown chains. */
export function chainName(chainId: string): string {
  return CHAIN_NAMES[chainId] ?? chainId
}

const PUBLIC_RPC: Record<string, string> = {
  [SN_MAIN]: 'https://starknet-mainnet.public.blastapi.io',
  [SN_SEPOLIA]: 'https://starknet-sepolia.public.blastapi.io',
}

/**
 * RPC URL for a chain. Precedence: per-chain env var → VITE_RPC_URL (sepolia
 * back-compat alias) → public RPC. Unknown chains have no URL — caller surfaces
 * that as a visible error instead of silently using another chain's endpoint.
 */
export function rpcUrlForChain(
  env: Record<string, string | undefined>,
  chainId: string,
): string | null {
  const perChain =
    env[`VITE_RPC_URL_${chainName(chainId).toUpperCase().replace(/[^A-Z]/g, '_')}`]
  return perChain || (chainId === SN_SEPOLIA ? env.VITE_RPC_URL : undefined) || PUBLIC_RPC[chainId] || null
}
