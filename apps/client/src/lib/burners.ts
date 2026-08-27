// Rotating burner wallets for private allowance scoops.
//
// Privacy model: the kid never links their real wallet to allowance income.
// Each cycle the kid mints a fresh keypair OFFLINE and posts only the predicted
// address on the encrypted board — the parent needs no secret. The stream
// accrues at that address; to collect, the kid deploys + signs from the burner
// once, then shields the entire balance into STRK20. The burner dies afterwards.
//
// Addresses are derived exactly like an OpenZeppelin account deploy:
// calculateContractAddressFromHash(salt, classHash, [pubkey], 0) — so the kid
// can publish the address before the account exists on-chain.
import { ec, hash, CallData, encode } from 'starknet'

export interface Burner {
  /** Private signing key (felt hex). NEVER leaves this device / gets posted. */
  privateKey: string
  /** starkCurve public key (felt hex). Goes into constructor calldata. */
  publicKey: string
  /** Predicted contract address — the ONLY thing shared on the board. */
  address: string
  salt: string
}

/**
 * Sepolia OpenZeppelin account class (what sncast/ArgentX standard flows use).
 * VERIFIED offline against a real sncast-created account address on sepolia.
 * Per-chain override via VITE_OZ_ACCOUNT_CLASS_HASH_<CHAIN> if mainnet differs.
 */
let ozClassHash = (globalThis as any).__OZ_CLASS_HASH__ || ''
export function setOzAccountClassHash(h: string) { ozClassHash = h }
export function OZ_ACCOUNT_CLASS_HASH(): string {
  if (!ozClassHash) throw new Error('OZ account class hash not configured (set VITE_OZ_ACCOUNT_CLASS_HASH_)')
  return ozClassHash
}

// Wire the vite env once at module load when running under vite (import.meta exists);
// node test harness injects via setOzAccountClassHash instead.
if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
  ozClassHash = (import.meta as any).env.VITE_OZ_ACCOUNT_CLASS_HASH_SEPOLIA || ''
}

function randomPrivateKey(): string {
  return encode.addHexPrefix(encode.buf2hex(ec.starkCurve.utils.randomPrivateKey()))
}
function randomSalt(): string {
  return encode.addHexPrefix(encode.buf2hex(ec.starkCurve.utils.randomPrivateKey()))
}

/** Rebuild a burner from its saved private key + salt (same address every time). */
export function burnerFromKey(privateKey: string, salt: string): Burner {
  const publicKey = ec.starkCurve.getStarkKey(privateKey)
  const calldata = CallData.compile({ public_key: publicKey })
  const address = hash.calculateContractAddressFromHash(salt, OZ_ACCOUNT_CLASS_HASH(), calldata, 0)
  return { privateKey, publicKey, address, salt }
}

/** Mint a fresh burner identity entirely offline. The address is final the
 *  moment it's derived — the account contract deploys only when the kid first
 *  collects, paying its way out of the streamed allowance itself. */
export function mintBurner(): Burner {
  return burnerFromKey(randomPrivateKey(), randomSalt())
}

/** Single-string recovery code, same pattern as family keys. */
export function exportBurner(b: Burner): string {
  return `maestro:burner:v1:${b.privateKey}:${b.salt}`
}
export function importBurner(code: string): Burner | { error: string } {
  try {
    const parts = code.trim().split(':')
    if (parts.length !== 5 || parts[0] !== 'maestro' || parts[1] !== 'burner' || parts[2] !== 'v1')
      return { error: 'not a maestro burner code' }
    return burnerFromKey(parts[3], parts[4])
  } catch {
    return { error: 'invalid burner key' }
  }
}

/**
 * Collection: deploy the burner account (if not yet on-chain), sponsored by the
 * kid's MAIN wallet (fee only — the allowance lands in the burner), then it's
 * one invoke from the burner to scoop, and one shield to remint everything.
 *
 * deployAccount requires a signature from the burner — starknet.js signs
 * locally with the burner's private key; no funds are needed pre-deploy since
 * the sponsor pays the deployment fee.
 */
export async function collectViaBurner(
  sponsor: import('starknet').WalletAccountV6,
  burner: Burner,
  drips: string,
  token: string,
): Promise<{ scoopedHash: string; balanceAfterScoop: bigint }> {
  const sn = await import('starknet')
  const provider = (sponsor as unknown as { provider: import('starknet').RpcProvider }).provider

  // 1. deploy the burner account contract — the SPONSOR pays the fee; the
  //    burner's signature authorizes it. Address matches the board posting.
  await sponsor.deployAccount({
    classHash: OZ_ACCOUNT_CLASS_HASH(),
    addressSalt: burner.salt,
    constructorCalldata: [burner.publicKey],
    contractAddress: burner.address,
  })

  // 2. the burner (now a real account) signs its own permissionless scoop
  const burnerAcct = new sn.Account({ provider, address: burner.address, signer: burner.privateKey })
  const call: import('starknet').Call = {
    contractAddress: drips,
    entrypoint: 'claim_as',
    calldata: [burner.address],
  }
  const scooped = await burnerAcct.execute(call)
  await provider.waitForTransaction(scooped.transaction_hash)

  // 3. read what landed and remint (shield) ALL of it into STRK20 for the
  //    real stash — the whole point: income becomes an unattributable note.
  const bal = await provider.callContract({
    contractAddress: token, entrypoint: 'balance_of', calldata: [burner.address],
  })
  const balance = BigInt(bal[0]) + (BigInt(bal[1] ?? '0') << 128n)
  if (balance === 0n) return { scoopedHash: scooped.transaction_hash, balanceAfterScoop: 0n }

  const actions = [{ type: 'deposit', token, amount: `0x${balance.toString(16)}` }] as never
  await (burnerAcct as unknown as { strk20InvokeTransaction(a: never): Promise<unknown> })
    .strk20InvokeTransaction(actions)
  return { scoopedHash: scooped.transaction_hash, balanceAfterScoop: balance }
}
