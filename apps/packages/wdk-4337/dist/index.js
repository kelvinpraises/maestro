// Build-time runtime stub for @xylkstream/wdk-4337.
// UI-only builds resolve this so the bundle compiles; the real ERC-4337 wallet
// dev kit is provided by the contract-wiring workstream. Every consumer gates on
// `isReady` / `stealthAddress` before calling into the manager, so in a UI-only
// build these methods are never reached at runtime. If they are, they throw
// clearly rather than silently no-op.

const NOT_IMPLEMENTED =
  "@xylkstream/wdk-4337 is a build-time stub (UI-only build). The real wallet dev kit is wired up by the contracts workstream.";

export default class WalletManagerEvmErc4337 {
  constructor() {
    // Intentionally inert.
  }

  async getAccountByPath() {
    throw new Error(NOT_IMPLEMENTED);
  }
}
