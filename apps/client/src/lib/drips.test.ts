// Runnable check: node src/lib/drips.test.ts — pure calldata builders only.
import assert from 'node:assert'
import { approveCall, openStreamSplitCall, claimAsCall } from './drips-calls.ts'

const token = '0xabc'
const drips = '0x123'

// approve: spender + u256 low/high
assert.deepEqual(approveCall(token, drips, 5n), {
  contractAddress: token,
  entrypoint: 'approve',
  calldata: [drips, '5', '0'],
})
// u256 splits at the 128-bit boundary
assert.deepEqual(approveCall(token, drips, 1n << 128n), {
  contractAddress: token,
  entrypoint: 'approve',
  calldata: [drips, '0', String(1n << 128n >> 128n)],
})

// split calldata: [len, a1, s1, a2, s2, rate, amtLow, amtHigh]
{
  const c = openStreamSplitCall(
    drips,
    [{ address: '0x10', share: 1n }, { address: '0x20', share: 3n }],
    7n,
    10n,
  )
  assert.equal(c.entrypoint, 'open_stream_split')
  assert.deepEqual(c.calldata, ['2', '16', '1', '32', '3', '7', '10', '0'])
}

// claim_as: single address arg
assert.deepEqual(claimAsCall(drips, '0x42'), { contractAddress: drips, entrypoint: 'claim_as', calldata: ['66'] })

console.log('drips.test: all assertions passed')
