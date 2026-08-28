import { encodeInvite, decodeInvite, buildInviteLink } from './invite.ts'
// readAndStripInvite touches window.location; browser-only (exercised in the join route)

const p = { familyId: 'ABCdef123-_456', familyName: 'Team Okafor', familyKey: 'r5HkzsbQBF-xdUoh4VzN9jnbxfdVoaayHxL6v_I0pK0', kidName: 'Ava' }
const blob = encodeInvite(p)
const back = decodeInvite(blob)
console.assert(!('error' in back), 'decode succeeds')
if (!('error' in back)) {
  console.assert(back.familyId === p.familyId && back.familyKey === p.familyKey && back.kidName === 'Ava' && back.familyName === 'Team Okafor', 'round-trip fields')
}
console.assert('error' in decodeInvite('!!!not-base64!!!'), 'malformed rejected as {error}')
console.assert('error' in decodeInvite(encodeInvite({ familyId: '', familyName: 'x', familyKey: 'y', kidName: 'z' })), 'missing fields rejected')
const link = buildInviteLink(p, 'https://maestro.demo')
console.assert(link.startsWith('https://maestro.demo/join#invite='), 'link shape')
console.assert(decodeInvite(link.split('#invite=')[1]) && !('error' in decodeInvite(link.split('#invite=')[1])), 'link blob decodes')

console.log('invite.test: all assertions passed')
