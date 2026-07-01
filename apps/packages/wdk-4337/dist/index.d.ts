// Build-time type stub for @xylkstream/wdk-4337.
// Mirrors only the surface consumed by src/providers/stealth-wallet-provider.tsx.
// The real implementation lands with the contract-wiring workstream; this exists
// solely so UI-only builds/type-checks resolve the import.

export interface EvmTransaction {
  to: string;
  data: string;
  value?: bigint;
}

export interface TransactionResult {
  hash: string;
  userOpHash?: string;
  txHash?: string;
}

export interface ApproveOptions {
  token: string;
  spender: string;
  amount: bigint;
}

export interface WalletAccountEvmErc4337 {
  getAddress(): Promise<string>;
  sendTransaction(tx: EvmTransaction | EvmTransaction[]): Promise<TransactionResult>;
  getTokenBalance(tokenAddress: string): Promise<bigint>;
  approve(options: ApproveOptions): Promise<TransactionResult>;
  dispose(): void;
}

export default class WalletManagerEvmErc4337 {
  constructor(secret: Uint8Array, config: unknown);
  getAccountByPath(path: string): Promise<WalletAccountEvmErc4337>;
}
