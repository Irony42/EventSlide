import { describe, expect, it } from 'vitest'
import { SLUG_MAX_LENGTH, slugify } from './slugify'

/**
 * These cases are copied from `src/domain/shared/slug.test.ts` on purpose.
 *
 * The web app cannot import the domain, so these cases are a local copy. The cross-check that runs
 * the web and the server slug on one table lives in
 * `src/interface/http/presenters/webMirrorsContract.test.ts`; if the server's rules move, that
 * contract is what has to fail.
 */
describe('slugify', () => {
  it('folds accents to their base letters, as the server does', () => {
    expect(slugify('Camille & Sacha à Lyon')).toBe('camille-sacha-a-lyon')
  })

  it('handles a name that is mostly diacritics', () => {
    expect(slugify('Fête de la Saint-Jean à Nîmes')).toBe('fete-de-la-saint-jean-a-nimes')
  })

  it('collapses a run of separators into a single dash', () => {
    expect(slugify('Anne   ///   Bob')).toBe('anne-bob')
  })

  it('trims the dashes it would otherwise leave at both ends', () => {
    expect(slugify('  -- Fête du village -- ')).toBe('fete-du-village')
  })

  it('truncates a very long name to the maximum length', () => {
    expect(slugify('a'.repeat(SLUG_MAX_LENGTH + 20))).toHaveLength(SLUG_MAX_LENGTH)
  })

  // Truncating mid-separator used to produce `...-`, which the server then rejected and
  // left the host staring at a preview they could not save.
  it('never leaves a trailing dash after truncating', () => {
    const name = `${'a'.repeat(SLUG_MAX_LENGTH - 1)} bravo`

    expect(slugify(name)).toBe('a'.repeat(SLUG_MAX_LENGTH - 1))
  })

  it('yields an empty string for a name made only of punctuation', () => {
    expect(slugify('!!! ??? ...')).toBe('')
  })

  it('leaves an already-slug-shaped value alone', () => {
    expect(slugify('camille-et-sacha')).toBe('camille-et-sacha')
  })
})
