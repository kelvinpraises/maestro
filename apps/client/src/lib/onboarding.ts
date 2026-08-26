// Pure onboarding helpers: family-id/key shape validation + export/import strings.
// Node-testable (no localStorage, no SDK).

/** Family ids are 128-bit values, base64url → 22 chars of [A-Za-z0-9_-]. */
export function validateFamilyId(id: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return 'Family ID should be 22 characters (letters, numbers, - or _)'
  return null
}

/** Keys are 256-bit values, base64url → 43 chars. */
export function validateRawKey(key: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return 'Family key should be 43 characters (letters, numbers, - or _)'
  return null
}

/** The single backup string a family should save somewhere safe. */
export function exportRecovery(familyId: string, rawKey: string): string {
  return `maestro:v1:${familyId}:${rawKey}`
}

/** Parse a recovery string; null + reason on any malformation. */
export function importRecovery(s: string): { familyId: string; rawKey: string } | { error: string } {
  const parts = s.trim().split(':')
  if (parts.length !== 4 || parts[0] !== 'maestro' || parts[1] !== 'v1') {
    return { error: 'That does not look like a Maestro recovery code.' }
  }
  const [, , familyId, rawKey] = parts
  const err = validateFamilyId(familyId) ?? validateRawKey(rawKey)
  return err ? { error: err } : { familyId, rawKey }
}
