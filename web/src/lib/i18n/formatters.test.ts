import { describe, expect, it } from 'vitest'
import { formattersFor } from './formatters'

/**
 * The three things a template literal gets wrong in at least one of the five languages.
 *
 * Nothing here pins a sentence. What is pinned is that the formatters are `Intl` and not
 * a hand-written rule, because a hand-written rule is what was there before and it was
 * the English one spelled out in French.
 */

describe('counting', () => {
  it('puts zero in the singular in French and in the plural in English', () => {
    // The whole reason this module exists. `count === 1 ? singular : plural` is the
    // English rule; French agrees a noun with zero as with one, so every counted phrase
    // in `fr.ts` read "0 photos" on the one screen that renders it — the moderation
    // queue, which is empty far more often than it holds exactly one photo.
    const fr = formattersFor('fr')
    const en = formattersFor('en')

    expect(fr.count(0, { one: 'photo', other: 'photos' })).toBe('photo')
    expect(en.count(0, { one: 'photo', other: 'photos' })).toBe('photos')
  })

  it('agrees the singular at one in every language', () => {
    for (const locale of ['fr', 'de', 'en', 'es', 'it'] as const) {
      expect(formattersFor(locale).count(1, { one: 'one', other: 'other' })).toBe('one')
    }
  })

  it('falls back to the plural form for a category the phrase did not spell out', () => {
    // CLDR has six categories and no language uses all of them, so a table writes the
    // ones its language selects. A phrase asked for a category it does not carry
    // answers clumsily rather than answering with nothing, which is the same rule the
    // French fallback follows everywhere else in this module.
    expect(formattersFor('fr').count(1, { other: 'photos' })).toBe('photos')
  })
})

describe('numbers', () => {
  it('groups thousands the way each language does', () => {
    // French uses a narrow no-break space, German and Italian a full stop, English a
    // comma. A template literal prints 1000 in all five, which is the figure nobody
    // writes down.
    expect(formattersFor('fr').number(1000)).not.toBe('1000')
    expect(formattersFor('de').number(1000)).toBe('1.000')
    expect(formattersFor('en').number(1000)).toBe('1,000')
  })

  it('leaves a small count alone, which is what most of the copy passes it', () => {
    expect(formattersFor('fr').number(3)).toBe('3')
    expect(formattersFor('de').number(3)).toBe('3')
  })
})

describe('percentages', () => {
  it('spaces the sign in French and does not in English', () => {
    // "80 %" and "80%". The space is part of the number format, not a character
    // somebody remembers to type, and the upload progress bar announces this figure to
    // a screen reader on every photo.
    const fr = formattersFor('fr').percent(80)
    const en = formattersFor('en').percent(80)

    expect(fr).toMatch(/^80\s%$/u)
    expect(en).toBe('80%')
  })

  it('takes 0 to 100 rather than a fraction, which is what a progress bar computes', () => {
    expect(formattersFor('en').percent(0)).toBe('0%')
    expect(formattersFor('en').percent(100)).toBe('100%')
  })
})
