/**
 * The first day anything was measured, for "Mesuré depuis le 14 novembre. Avant, rien n'était
 * compté." `null` when no day was ever recorded. Days are `YYYY-MM-DD`, so text order is date order.
 */
export const engagementSince = (days: readonly string[]): string | null =>
  days.reduce<string | null>((first, day) => (first === null || day < first ? day : first), null)
