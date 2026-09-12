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

/**
 * Octets, then the prefixes a count can be promoted into.
 *
 * Destructured rather than indexed: the promotion below walks the prefixes themselves,
 * so the unit is bound by the iteration and there is no index for
 * `noUncheckedIndexedAccess` to type as possibly-undefined. The earlier form needed a
 * `?? UNITS[0]` fallback no input could ever reach.
 */
const [OCTETS, ...LARGER_UNITS] = UNITS

export const formatBytes = (bytes: number): string => {
  // A negative or non-finite count is a server bug, and "-2 Mo" would send a host
  // hunting for a storage problem that does not exist.
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0

  let value = safe
  let unit: string = OCTETS
  let promoted = false

  for (const larger of LARGER_UNITS) {
    // Rounded before comparing, so the figure that will be *printed* decides: 999 950
    // octets is 999,95 ko, which prints as "1000 ko" — a figure the reader has to
    // convert in their head — and carries to "1 Mo" instead.
    if (Number(value.toFixed(promoted ? 1 : 0)) < STEP) break
    value /= STEP
    unit = larger
    promoted = true
  }

  const formatted = value.toLocaleString('fr-FR', {
    // Octets are whole things; a fraction of one is noise.
    maximumFractionDigits: promoted ? 1 : 0,
  })

  return `${formatted}${NO_BREAK_SPACE}${unit}`
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
