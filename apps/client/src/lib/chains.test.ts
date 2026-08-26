// Runnable check: node --experimental-strip-types src/lib/chains.test.ts (or just `node`, v26+)
import assert from 'node:assert'
import { SN_MAIN, SN_SEPOLIA, chainName, rpcUrlForChain } from './chains.ts'

// known chains map to names
assert.equal(chainName(SN_MAIN), 'Mainnet')
assert.equal(chainName(SN_SEPOLIA), 'Sepolia')
// unknown chains fall back to raw value, no throw
assert.equal(chainName('0xdeadbeef'), '0xdeadbeef')

// per-chain env wins over everything
assert.equal(rpcUrlForChain({ VITE_RPC_URL_MAINNET: 'http://a', VITE_RPC_URL: 'http://b' }, SN_MAIN), 'http://a')
// sepolia falls back to legacy VITE_RPC_URL alias
assert.equal(rpcUrlForChain({ VITE_RPC_URL: 'http://sep' }, SN_SEPOLIA), 'http://sep')
// mainnet ignores the sepolia alias, uses public fallback
assert.equal(rpcUrlForChain({ VITE_RPC_URL: 'http://sep' }, SN_MAIN), 'https://starknet-mainnet.public.blastapi.io')
// unknown chain → null (caller must surface a visible error)
assert.equal(rpcUrlForChain({}, '0xdeadbeef'), null)

console.log('chains.test: all assertions passed')
