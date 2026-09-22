import type { Locale } from './i18n/locale'

/**
 * Human-readable numbers and dates, in the conventions of the language on screen.
 *
 * A quota is the one figure a host acts on — "the album is nearly full" is a decision,
 * `4831838208` is not. 1.0 printed raw byte counts in the admin page and nobody ever
 * read them.
 *
 * **Both functions used to be hard-wired to `fr-FR`**, and that was right for exactly as
 * long as the console they print on was French. Roadmap 1.5's second half made it wrong
 * in a way the surrounding sentence hides: `admin.storageUsed` is translated, so a
 * moderator reading the console in German got "2,4 Mo von 5 Go verwendet" — `Mo` and `Go`
 * are the French abbreviations for octets, and German writes `MB` and `GB`. The date was
 * worse than jarring: `20/06/26` in front of a host reading English is read as 6 June,
 * and the sentence it appears in is the confirmation of a schedule they just armed.
 *
 * So the locale is a parameter. `lib/i18n/formatters.ts` already argues why a number must
 * not be assembled by hand; this was the module still doing it, and the hand-written
 * `['o', 'ko', 'Mo', 'Go', 'To']` it carried is gone — `Intl` knows the abbreviation in
 * all five, including that French counts octets and the other four count bytes.
 */

/**
 * A no-break space, so "2,4 Mo" never wraps between the number and its unit. Written as a
 * code point rather than as a literal: an invisible character in a source file is
 * indistinguishable from an ordinary space in every review tool.
 */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0)

/** Decimal prefixes, not binary: a host compares this to what their phone reports. */
const STEP = 1000

/**
 * The units a count can be promoted through, as `Intl` names them.
 *
 * `byte` first, then the four prefixes. Destructured rather than indexed for the reason
 * the French array it replaces was: the promotion below walks the prefixes themselves, so
 * the unit is bound by the iteration and there is no index for `noUncheckedIndexedAccess`
 * to type as possibly-undefined.
 */
const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const
const [BYTES, ...LARGER_UNITS] = UNITS

export const formatBytes = (bytes: number, locale: Locale): string => {
  // A negative or non-finite count is a server bug, and "-2 Mo" would send a host
  // hunting for a storage problem that does not exist.
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0

  let value = safe
  let unit: (typeof UNITS)[number] = BYTES
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

  // `style: 'unit'` rather than a number and a string joined by hand. It is what puts the
  // right abbreviation in each language — French counts octets (`o`, `ko`, `Mo`) and the
  // other four count bytes (`B`, `kB`, `MB`) — without this module holding a table of five
  // vocabularies it would have to keep true.
  const formatted = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    // Octets are whole things; a fraction of one is noise.
    maximumFractionDigits: promoted ? 1 : 0,
  }).format(value)

  /**
   * The one thing `Intl` will not promise, and the product does.
   *
   * CLDR puts a **narrow** no-break space before the unit in French and an ordinary,
   * breakable one in the other four — so "2,4 MB" in a narrow meter can wrap between the
   * figure and its unit, which is the defect the hand-built version's `NO_BREAK_SPACE`
   * existed to prevent and the reason it is not deleted with the rest of it.
   *
   * Safe as a blanket substitution because a plain space is the *only* place one can
   * appear here: these five languages group thousands with U+202F, a full stop, a comma or
   * nothing at all, never with U+0020. Nothing else about the string is touched — the
   * abbreviation, the decimal mark and the grouping stay exactly as the language writes
   * them.
   */
  return formatted.replace(/ /gu, NO_BREAK_SPACE)
}

/**
 * A date and time for the reader's own screen: short, local, unambiguous.
 *
 * "Unambiguous" is the word that needed the locale. `20/06/26` and `6/20/26` are the same
 * instant and opposite readings, and this string is interpolated into
 * `admin.scheduleArmed` — the line that tells a host when their event will open and close.
 *
 * `null` rather than a placeholder when the value cannot be read, so the caller chooses
 * the wording instead of this module inventing one in a language it does not know.
 */
export const formatDateTime = (iso: string, locale: Locale): string | null => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  return date.toLocaleString(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}
