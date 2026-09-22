/**
 * Which languages the app speaks, and how one is chosen.
 *
 * Nothing in here knows what a translation looks like: this module is the contract for
 * the *choice*, and `translations.ts` is the contract for the words. Keeping them apart
 * is what lets the choice be unit-tested without loading a single sentence.
 *
 * **French is the default and stays the default.** A deployment with no signal at all
 * — a browser that sends nothing, a table that has no entry — lands on French, which is
 * the language this product is written in and the one its author supports.
 */

/**
 * The five, in the order the picker shows them.
 *
 * French first because it is the default; the other four alphabetically by their own
 * name, which is the order a guest scanning the list reads them in — not by ISO code,
 * which would put German before English for no reason a guest could see.
 */
export const SUPPORTED_LOCALES = ['fr', 'de', 'en', 'es', 'it'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE = 'fr' satisfies Locale

/**
 * The boundary parser for a language tag: `unknown` in, a `Locale` or `null` out.
 *
 * A locale arrives from two untrusted places — `localStorage`, which the guest's own
 * browser hands back and which may hold whatever an older build or another tab wrote,
 * and the value of the picker's `<select>`, which comes out of the DOM as a bare string
 * and is whatever the last thing to touch the page left there. Both go through this.
 *
 * **Not zod, deliberately, and please do not "fix" it back.** CLAUDE.md §3.3 is written
 * about `req.body`, `req.query`, `req.params`, env vars and SSE payloads: open-ended
 * shapes crossing a server boundary, where a schema earns its keep. This is membership
 * in a five-element frozen tuple. `web/src/lib/http.ts` (`isApiErrorBody`) and
 * `web/src/lib/guestSession.ts` already narrow by hand for the same reason, so the
 * hand-written guard *is* this app's pattern on the client side.
 *
 * The measurement settles it, and it is a cost avoided rather than a saving: zod has
 * never been in `web/src` on `main`. The first draft of this module introduced it, a
 * build with and without it put the difference at **12.3 kB gzipped in the guest's
 * eagerly-loaded chunk**, and that is what buying a schema for this would cost — on the
 * one chunk CLAUDE.md §1 says is paid for in the seconds that decide whether a guest
 * bothers to send a photo. Nothing was reclaimed from the bundle; a regression was
 * measured and then not shipped.
 *
 * Total by construction: the `typeof` guard means a number, an object, `null` and the
 * `null` that `localStorage.getItem` answers with all take the same path as an
 * unsupported tag.
 */
export const parseLocale = (value: unknown): Locale | null => {
  if (typeof value !== 'string') return null
  return SUPPORTED_LOCALES.find((locale) => locale === value) ?? null
}

/**
 * Each language named in itself.
 *
 * Endonyms, never translations. A guest whose phone is in Spanish is looking for
 * "Español" in the list; "Espagnol" is a word they may not know, and the whole point of
 * the picker is that it works for somebody who cannot read the language it is rendered
 * in. This is also why the picker never shows a flag: a flag is a country, and Spanish
 * is not Spain.
 */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  fr: 'Français',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  it: 'Italiano',
}

/**
 * The language to use, from the browser's own ordered preference list.
 *
 * `navigator.languages` is the client-side half of `Accept-Language`: the browser
 * builds both from the same setting, and this app has no server-side rendering, so the
 * header never reaches anything that could act on it. The list is already in preference
 * order and carries no quality values, so there is nothing to sort — the first entry
 * whose primary subtag is one of ours wins.
 *
 * Matched on the primary subtag only. `fr-CA`, `de-AT` and `es-419` are the same five
 * tables as `fr`, `de` and `es`: regional copy is a different product decision, and
 * falling back to the base language is right in every case where it is not made.
 */
export const negotiate = (preferences: readonly string[]): Locale => {
  for (const preference of preferences) {
    const primary = preference.split('-')[0]?.toLowerCase()
    const supported = SUPPORTED_LOCALES.find((locale) => locale === primary)
    if (supported !== undefined) return supported
  }
  return DEFAULT_LOCALE
}
