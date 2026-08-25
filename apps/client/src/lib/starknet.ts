import { RpcProvider } from 'starknet'

// Chain-derived config. RPC URL comes from env; network identity is always read
// off the connected chain (never assumed from env).
export const rpcUrl = import.meta.env.VITE_RPC_URL || 'https://starknet-sepolia.public.blastapi.io'

export const provider = new RpcProvider({ nodeUrl: rpcUrl })

const CHAIN_NAMES: Record<string, string> = {
  '0x534e5f4d41494e': 'Mainnet', // SN_MAIN
  '0x534e5f5345504f4c4941': 'Sepolia', // SN_SEPOLIA
}

/** Human name for a raw chainId; falls back to the raw value for unknown chains. */
export function chainName(chainId: string): string {
  return CHAIN_NAMES[chainId] ?? chainId
}

export function trimAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
