// Runnable check: node src/lib/onboarding.test.ts
import assert from 'node:assert'
import { validateFamilyId, validateRawKey, exportRecovery, importRecovery } from './onboarding.ts'
import { mintFamily } from './board.ts'

// valid shapes from the real mint path round-trip
const fam = mintFamily()
assert.equal(validateFamilyId(fam.familyId), null)
assert.equal(validateRawKey(fam.rawKey), null)

const code = exportRecovery(fam.familyId, fam.rawKey)
const back = importRecovery(code)
assert.deepEqual(back, { familyId: fam.familyId, rawKey: fam.rawKey })

// whitespace-tolerant (someone will paste with a trailing newline)
assert.deepEqual(importRecovery(`  ${code}\n`), { familyId: fam.familyId, rawKey: fam.rawKey })

// wrong strings all rejected with a reason — no silent corruption
assert.ok((importRecovery('hello world') as { error: string }).error)
assert.ok((importRecovery('maestro:v2:x:y') as { error: string }).error)
assert.ok((importRecovery(exportRecovery('short', fam.rawKey)) as { error: string }).error.includes('22'))
assert.ok((importRecovery(exportRecovery(fam.familyId, 'shortkey')) as { error: string }).error.includes('43'))

// validators reject junk directly too
assert.ok(validateFamilyId('nope'))
assert.ok(validateRawKey('nope'))

console.log('onboarding.test: all assertions passed')
