import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, LOCALE_NAMES, SUPPORTED_LOCALES, negotiate, parseLocale } from './locale'
import { ORTHOGRAPHY, repertoireFor } from './testing/orthography'

/**
 * Choosing a language, with no table loaded and no browser involved.
 *
 * `negotiate` takes the list rather than reading `navigator.languages` for itself,
 * which is what makes the interesting cases — a region subtag, a language this build
 * does not have, an empty list — plain function calls instead of a jsdom fixture.
 */

describe('negotiate', () => {
  it('takes the first preference it has a table for', () => {
    expect(negotiate(['de', 'en'])).toBe('de')
  })

  it('reads a region subtag as its base language', () => {
    // A phone bought in Geneva reports `fr-CH`, one in Austria `de-AT`, and a Latin
    // American Android `es-419`. Regional copy is a different product decision; falling
    // back to the base language is right in every case where it has not been made.
    expect(negotiate(['fr-CH'])).toBe('fr')
    expect(negotiate(['de-AT'])).toBe('de')
    expect(negotiate(['es-419'])).toBe('es')
  })

  it('ignores case in the tag', () => {
    // `navigator.languages` is conventionally `en-GB`, but the specification does not
    // require a casing and a proxy rewriting `Accept-Language` does not preserve one.
    expect(negotiate(['IT-it'])).toBe('it')
  })

  it('skips a language it has no table for and keeps looking', () => {
    // A Portuguese guest at a French wedding whose phone also lists Spanish gets
    // Spanish, not French. Stopping at the first entry would have cost them the one
    // language in the list they can actually read.
    expect(negotiate(['pt-BR', 'es-ES', 'en'])).toBe('es')
  })

  it('falls back to French when nothing in the list is supported', () => {
    expect(negotiate(['pt', 'ja', 'ar'])).toBe(DEFAULT_LOCALE)
  })

  it('falls back to French for an empty list', () => {
    // A browser that reports no preference at all, and the `*` wildcard, both land
    // here: neither says anything about what the guest reads.
    expect(negotiate([])).toBe(DEFAULT_LOCALE)
    expect(negotiate(['*'])).toBe(DEFAULT_LOCALE)
  })
})

describe('parseLocale', () => {
  it.each(SUPPORTED_LOCALES)('accepts %s', (locale) => {
    expect(parseLocale(locale)).toBe(locale)
  })

  it('refuses a language this build has no table for', () => {
    expect(parseLocale('pt')).toBeNull()
  })

  it('refuses what a browser hands back when nothing was ever stored', () => {
    // `localStorage.getItem` answers `null`, and a `null` that resolved to a locale
    // would make "no preference" indistinguishable from "French, chosen".
    expect(parseLocale(null)).toBeNull()
  })

  it('refuses a value that is not a string at all', () => {
    expect(parseLocale(42)).toBeNull()
    expect(parseLocale({ locale: 'fr' })).toBeNull()
  })
})

describe('the names in the picker', () => {
  it('names every supported language', () => {
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('writes each name in its own language', () => {
    // "Français" with its cedilla and "Español" with its eñe, not "Francais" and
    // "Espanol". This is the list a guest scans when the page is in a language they
    // cannot read, so it is the one place where a stripped accent is most visible.
    for (const locale of SUPPORTED_LOCALES) {
      const name = LOCALE_NAMES[locale]
      const allowed = repertoireFor(locale)
      for (const character of name) {
        expect(allowed.has(character), `${name} uses ${character}, which is not ${locale}`).toBe(
          true,
        )
      }
    }
  })

  it('gives French and Spanish the accents their own names carry', () => {
    expect(LOCALE_NAMES.fr).toContain('ç')
    expect(LOCALE_NAMES.es).toContain('ñ')
  })
})

describe('the orthography contract', () => {
  it('describes every supported language', () => {
    // A language added to `SUPPORTED_LOCALES` without a row here would be the only one
    // whose spelling nothing checks, and it would be green.
    expect(Object.keys(ORTHOGRAPHY).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })
})
