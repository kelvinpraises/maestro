// Pure chain metadata — no vite/import.meta, no SDK imports. Testable under plain node.
export const SN_MAIN = '0x534e5f4d41494e'
export const SN_SEPOLIA = '0x534e5f5345504f4c4941'

const CHAIN_NAMES: Record<string, string> = {
  [SN_MAIN]: 'Mainnet',
  [SN_SEPOLIA]: 'Sepolia',
}

/** Canonical STRK token addresses, per chain. Env override wins. */
export const STRK_TOKENS: Record<string, string> = {
  [SN_MAIN]: '0x4718f5a0fc347c97dcbf3b4f216a47cbd1f1067ebb3f2753f45e3028ec6f5a72',
  [SN_SEPOLIA]: '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
}

/** STRK address for a chain: VITE_STRK_TOKEN_<CHAIN> env override → canonical. */
export function strkTokenForChain(
  env: Record<string, string | undefined>,
  chainId: string,
): string | null {
  const suffix = chainName(chainId).toUpperCase().replace(/[^A-Z]/g, '_')
  return env[`VITE_STRK_TOKEN_${suffix}`] || STRK_TOKENS[chainId] || null
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
