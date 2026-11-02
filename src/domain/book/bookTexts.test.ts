import { describe, expect, it } from 'vitest'
import { EVENT_LANGUAGES } from '../events/eventLanguage'
import { BOOK_LANGUAGES, BOOK_TEXTS, formatBookDate, videosNoteFor } from './bookTexts'

describe('book texts', () => {
  it('cover exactly the languages of an event', () => {
    expect([...BOOK_LANGUAGES]).toEqual([...EVENT_LANGUAGES])
    expect(Object.keys(BOOK_TEXTS).sort()).toEqual([...EVENT_LANGUAGES].sort())
  })
  it('formats the cover date in each language, reading the UTC calendar day', () => {
    const at = new Date('2026-11-01T12:00:00Z')
    expect(formatBookDate(at, 'fr')).toBe('1er novembre 2026')
    expect(formatBookDate(new Date('2026-06-14T12:00:00Z'), 'fr')).toBe('14 juin 2026')
    expect(formatBookDate(at, 'en')).toBe('November 1, 2026')
    expect(formatBookDate(at, 'de')).toBe('1. November 2026')
    expect(formatBookDate(at, 'es')).toBe('1 de noviembre de 2026')
    expect(formatBookDate(at, 'it')).toBe('1 novembre 2026')
  })
  it('says nothing about videos when there are none, and agrees in number otherwise', () => {
    for (const language of EVENT_LANGUAGES) {
      expect(videosNoteFor(0, language)).toBeNull()
      expect(videosNoteFor(1, language)).toContain('1')
      expect(videosNoteFor(3, language)).toContain('3')
      expect(videosNoteFor(1, language)).not.toBe(videosNoteFor(3, language))
      expect(BOOK_TEXTS[language].createdWith).toContain('EventSlide')
    }
  })
})
