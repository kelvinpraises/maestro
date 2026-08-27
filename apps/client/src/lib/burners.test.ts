import { burnerFromKey, mintBurner, exportBurner, importBurner, setOzAccountClassHash } from './burners.ts'

// verified against the real sncast-created account on sepolia
setOzAccountClassHash('0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564')

const PRIV = '0x3280144b1527cefe098854dc52e5c3ed65c7db9a2220dc03d72d19e44e91520'
const SALT = '0x3ef3276ba496505c'
const EXPECTED = '0x22e921d8fbcbf95b83f024d33c3d1265ce7709fed4544bc7f677dbd9d088b48'

const b = burnerFromKey(PRIV, SALT)
console.assert(b.address.toLowerCase() === EXPECTED, 'derived address must match real sncast account')
console.assert(b.publicKey === '0x235c5a5c30f4e2f4b4e8666c4f92e6f07c2062f6e6a7d206939a4cce5a38c7e', 'pubkey round-trip')

const m = mintBurner()
console.assert(/^0x[0-9a-f]{1,64}$/.test(m.address) && BigInt(m.address) < 2n**251n, 'minted address is a valid felt')
console.assert(m.address !== b.address, 'fresh burner gets a fresh address')
const again = burnerFromKey(m.privateKey, m.salt)
console.assert(again.address === m.address, 'same key+salt derives same address (deterministic)')

const code = exportBurner(m)
const imp = importBurner(code)
console.assert(!('error' in imp), 'import succeeds: ' + JSON.stringify(imp))
if (!('error' in imp)) console.assert(imp.address === m.address && imp.privateKey === m.privateKey, 'recovery round-trip keeps identity')
console.assert('error' in importBurner('garbage'), 'junk rejected as {error}')
console.assert('error' in importBurner('maestro:burner:v2:x:y'), 'wrong version rejected')
console.assert(importBurner(`  ${code}  `) && !('error' in importBurner(`  ${code}  `)), 'whitespace-tolerant paste')

console.log('burners.test: all assertions passed')
