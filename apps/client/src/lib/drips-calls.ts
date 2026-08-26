// Pure calldata builders for the drips contract — node-testable, zero imports.
export type Call = { contractAddress: string; entrypoint: string; calldata: string[] }

export function approveCall(token: string, drips: string, amount: bigint): Call {
  return {
    contractAddress: token,
    entrypoint: 'approve',
    calldata: [drips, (amount & 0xffffffffffffffffffffffffffffffffn).toString(), (amount >> 128n).toString()],
  }
}

/** recipients: Span<(address, u128)> serializes as [len, a1, s1, a2, s2…]; amount is u256 low/high. */
export function openStreamSplitCall(drips: string, recipients: Array<{ address: string; share: bigint }>, ratePerSec: bigint, amount: bigint): Call {
  const cd: string[] = [String(recipients.length)]
  for (const r of recipients) {
    cd.push(BigInt(r.address).toString())
    cd.push(r.share.toString())
  }
  cd.push(ratePerSec.toString())
  cd.push((amount & 0xffffffffffffffffffffffffffffffffn).toString(), (amount >> 128n).toString())
  return { contractAddress: drips, entrypoint: 'open_stream_split', calldata: cd }
}

export function claimAsCall(drips: string, who: string): Call {
  return { contractAddress: drips, entrypoint: 'claim_as', calldata: [BigInt(who).toString()] }
}
