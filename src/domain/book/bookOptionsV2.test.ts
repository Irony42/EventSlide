import { describe, expect, it } from 'vitest'
import { THEME_AMBIANCES } from '../events/eventTheme'
import {
  BOOK_SELECTION_TARGETS,
  BOOK_STYLES,
  defaultBookStyle,
  legacyBookOptions,
} from './bookOptionsV2'

describe('defaultBookStyle', () => {
  it('suggests the style that looks like the wall', () => {
    expect(Object.fromEntries(THEME_AMBIANCES.map((a) => [a, defaultBookStyle(a)]))).toEqual({
      noces: 'classique',
      champs: 'classique',
      eventslide: 'classique',
      custom: 'classique',
      riviera: 'magazine',
      cabaret: 'magazine',
      guinguette: 'souvenir',
      bivouac: 'souvenir',
    })
  })
})

describe('closed lists', () => {
  it('name three styles and three lengths', () => {
    expect([...BOOK_STYLES]).toEqual(['classique', 'magazine', 'souvenir'])
    expect([...BOOK_SELECTION_TARGETS]).toEqual([60, 120, 200])
  })
})

describe('legacyBookOptions', () => {
  it('turns a v1 request into a Classique book with every photo, no guest book, no printer version', () => {
    expect(
      legacyBookOptions({
        title: 'Noces',
        subtitle: 'Juin',
        language: 'de',
        layout: 'four',
        showAuthors: false,
        showCaptions: true,
      }),
    ).toEqual({
      title: 'Noces',
      subtitle: 'Juin',
      language: 'de',
      style: 'classique',
      selection: { kind: 'all' },
      showAuthors: false,
      showCaptions: true,
      includeGuestbook: false,
      printVersion: false,
      timeZone: 'Europe/Paris',
    })
  })
})
