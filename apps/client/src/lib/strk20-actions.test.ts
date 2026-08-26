// Runnable check: node src/lib/strk20-actions.test.ts
import assert from 'node:assert'
import {
  shieldActions,
  unshieldActions,
  privateTransferActions,
  sameAddress,
  DEV_SHIELD_AMOUNT,
} from './strk20-actions.ts'

// shield builds a single deposit action
assert.deepEqual(shieldActions('0xtoken', '10'), [{ type: 'deposit', token: '0xtoken', amount: '10' }])

// withdraw carries a recipient
assert.deepEqual(unshieldActions('0xtok', '5', '0xme'), [
  { type: 'withdraw', token: '0xtok', amount: '5', recipient: '0xme' },
])

// transfer carries a recipient; OPEN literal accepted for open notes
assert.deepEqual(privateTransferActions('0xtok', 'OPEN', '0xr'), [
  { type: 'transfer', token: '0xtok', amount: 'OPEN', recipient: '0xr' },
])
assert.deepEqual(privateTransferActions('0xtok', '7', '0xr')[0]!.type, 'transfer')

// dev default amount parses to 0.01 token (18 decimals) as a BigInt
assert.equal(BigInt(DEV_SHIELD_AMOUNT), 10n ** 16n)

// felt normalization: padded vs unpadded hex are the same address; garbage is not
const addr = '0x4718f5a0fc347c97dcbf3b4f216a47cbd1f1067ebb3f2753f45e3028ec6f5a72'
assert.equal(sameAddress(addr, `0x${addr.slice(2).padStart(64, '0')}`), true)
assert.equal(sameAddress(addr, '0xdeadbeef'), false)
assert.equal(sameAddress('not-hex', 'also-not'), false)

console.log('strk20-actions.test: all assertions passed')
