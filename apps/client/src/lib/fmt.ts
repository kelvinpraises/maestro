// Shared formatters — one definition so dashboard/family/pot agree exactly.
const STRK = 10n ** 18n
export function fmtReward(felt: string): string {
  try { return `${Number((BigInt(felt) * 100n) / STRK) / 100}` } catch { return '?' }
}
