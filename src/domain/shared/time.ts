/** A day in milliseconds. Fixed-length: the product counts retention and lifetimes in UTC days. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000

/** The instant `days` days after `at` (before it, for a negative count). `at` is not modified. */
export const addDays = (at: Date, days: number): Date => new Date(at.getTime() + days * MS_PER_DAY)
