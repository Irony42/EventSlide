import type { Locale } from './locale'

/**
 * The parts of a sentence that are not words.
 *
 * A counted phrase, a number and a percentage all disagree between the five languages,
 * and none of the three disagreements is visible to somebody writing the copy:
 *
 * - **Counts.** French puts zero in the singular — "0 photo" — and English, German,
 *   Spanish and Italian put it in the plural. Every counted phrase in this app was a
 *   `count === 1 ? … : …`, which is the English rule spelled out by hand, so the French
 *   table read "0 photos" on the one screen that renders it. `Intl.PluralRules` knows
 *   the rule for all five and is the only thing that should be asked.
 * - **Numbers.** "1 000" in French with a narrow no-break space, "1.000" in German and
 *   Italian, "1,000" in English. A template literal prints "1000" in all five.
 * - **Percentages.** "80 %" in French and German, "80%" in English. The space is part of
 *   the number format, not a character somebody remembers to type.
 *
 * Bound to one locale by {@link formattersFor} and held by the table that uses them, so
 * a phrase never has to take a locale parameter and no call site changes when a
 * language is added.
 */

/**
 * The plural forms a phrase spells out.
 *
 * `other` is required and the rest are optional, which is exactly the CLDR contract:
 * every language has `other`, and no language has all six. A form the language never
 * selects is simply never read; a form it selects and the table did not write falls
 * back to `other`, which is a clumsy sentence rather than an empty one.
 */
export type PluralForms = { readonly other: string } & Partial<Record<Intl.LDMLPluralRule, string>>

export interface Formatters {
  /** The form of `forms` this language uses for `value`. */
  readonly count: (value: number, forms: PluralForms) => string
  /** A number in this language's own grouping and decimal conventions. */
  readonly number: (value: number) => string
  /** A percentage, taken as 0–100 because that is what a progress bar computes. */
  readonly percent: (value: number) => string
}

/**
 * The three formatters for one language, built once.
 *
 * `Intl.PluralRules` and `Intl.NumberFormat` are expensive to construct and free to
 * reuse, and a table builds its set at module load — so the cost is five constructions
 * per format for the whole session rather than one per render on a phone.
 */
export const formattersFor = (locale: Locale): Formatters => {
  const plurals = new Intl.PluralRules(locale)
  const numbers = new Intl.NumberFormat(locale)
  const percents = new Intl.NumberFormat(locale, { style: 'percent' })

  return {
    count: (value, forms) => forms[plurals.select(value)] ?? forms.other,
    number: (value) => numbers.format(value),
    percent: (value) => percents.format(value / 100),
  }
}
