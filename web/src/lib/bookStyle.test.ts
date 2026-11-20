import { describe, expect, it } from 'vitest'
import { THEME_AMBIANCES } from '../design-system/eventTheme'
import { BOOK_LENGTH_TARGET, BOOK_LENGTHS, BOOK_STYLES, defaultBookStyle } from './bookStyle'

/**
 * What the form offers, on its own terms. That each choice is the server's is pinned from the
 * other side, in `src/interface/http/presenters/bookStyleContract.test.ts`: the web cannot import
 * the domain.
 */

describe('the style an ambiance suggests', () => {
  it('is one of the three styles, for every ambiance', () => {
    for (const ambiance of THEME_AMBIANCES)
      expect(BOOK_STYLES).toContain(defaultBookStyle(ambiance))
  })

  it('suggests every style somewhere, and Classique by default', () => {
    expect(new Set(THEME_AMBIANCES.map(defaultBookStyle))).toEqual(new Set(BOOK_STYLES))
    expect(defaultBookStyle('eventslide')).toBe('classique')
  })
})

describe('the lengths of a selection', () => {
  it('grow from short to long, three of them', () => {
    expect(BOOK_LENGTHS).toEqual(['short', 'medium', 'long'])
    const targets = BOOK_LENGTHS.map((length) => BOOK_LENGTH_TARGET[length])
    expect([...targets].sort((a, b) => a - b)).toEqual(targets)
  })
})
