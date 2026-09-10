/**
 * Human-readable numbers and dates, in French conventions.
 *
 * A quota is the one figure a host acts on — "the album is nearly full" is a decision,
 * `4831838208` is not. 1.0 printed raw byte counts in the admin page and nobody ever
 * read them.
 */

/**
 * A no-break space, so "2,4 Mo" never wraps between the number and its unit. Written
 * as a code point rather than as a literal: an invisible character in a source file is
 * indistinguishable from an ordinary space in every review tool.
 */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0)

/** Decimal prefixes, not binary: a host compares this to what their phone reports. */
const STEP = 1000
const UNITS = ['o', 'ko', 'Mo', 'Go', 'To'] as const

const lastUnitIndex = UNITS.length - 1

/**
 * `UNITS` is a tuple and the loops below keep the index inside it, but
 * `noUncheckedIndexedAccess` does not know that. Octets are the floor, so they are the
 * fallback: a literal index into the tuple is the one form that types as a string.
 */
const unitAt = (index: number): string => UNITS[index] ?? UNITS[0]

export const formatBytes = (bytes: number): string => {
  // A negative or non-finite count is a server bug, and "-2 Mo" would send a host
  // hunting for a storage problem that does not exist.
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0

  let value = safe
  let index = 0
  while (index < lastUnitIndex && value >= STEP) {
    value /= STEP
    index += 1
  }

  // Round, then carry: 999 950 octets would otherwise print as "1000 ko", a figure the
  // reader has to convert in their head.
  if (index < lastUnitIndex && Number(value.toFixed(1)) >= STEP) {
    value /= STEP
    index += 1
  }

  const formatted = value.toLocaleString('fr-FR', {
    // Octets are whole things; a fraction of one is noise.
    maximumFractionDigits: index === 0 ? 0 : 1,
  })

  return `${formatted}${NO_BREAK_SPACE}${unitAt(index)}`
}

/**
 * A date and time for the host's own screen: short, local, unambiguous.
 *
 * `null` rather than a placeholder when the value cannot be read, so the caller
 * chooses the French wording instead of this module inventing one.
 */
export const formatDateTime = (iso: string): string | null => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  return date.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}
