import { describe, expect, it } from 'vitest'
import { EVENT_LANGUAGES } from '../events/eventLanguage'
import { BOOK_LANGUAGES, BOOK_TEXTS, videosNoteFor } from './bookTexts'

describe('book texts', () => {
  it('cover exactly the languages of an event', () => {
    expect([...BOOK_LANGUAGES]).toEqual([...EVENT_LANGUAGES])
    expect(Object.keys(BOOK_TEXTS).sort()).toEqual([...EVENT_LANGUAGES].sort())
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

describe('story texts', () => {
  it('exist in every language, with a singular where the count changes the sentence', () => {
    for (const language of EVENT_LANGUAGES) {
      const t = BOOK_TEXTS[language]
      expect(t.weekdays).toHaveLength(7)
      for (const moment of ['morning', 'afternoon', 'evening', 'night'] as const) {
        expect(t.moments[moment].title.length).toBeGreaterThan(2)
        expect(t.moments[moment].inline.length).toBeGreaterThan(2)
      }
      for (const text of [
        t.contents,
        t.statsTitle,
        t.statPhotos,
        t.statPhotographers,
        t.statHearts,
        t.statMessages,
        t.favourites,
        t.guestbook,
      ]) {
        expect(text.length).toBeGreaterThan(2)
      }
      expect(t.photoCount(1)).not.toBe(t.photoCount(3))
      expect(t.photoCount(3)).toContain('3')
      expect(t.extraMessages(1)).not.toBe(t.extraMessages(3))
      expect(t.extraMessages(3)).toContain('3')
      expect(t.voicesNotIncluded(1)).not.toBe(t.voicesNotIncluded(3))
      expect(t.voicesNotIncluded(3)).toContain('3')
      expect(t.thanksTo(12)).toContain('12')
      expect(t.thanksAnonymous(12)).toContain('12')
      expect(t.thanksTo(12)).not.toBe(t.thanksAnonymous(12))
      expect(t.timeRange('A', 'B')).toMatch(/A.*B/)
      expect(t.withDay('X', 'y')).toMatch(/X.*y/)
      expect(t.continued('T')).toContain('T')
      expect(t.mission('boire')).toContain('boire')
    }
  })

  it('puts a non-breaking space before the colon of the French mission label', () => {
    expect(BOOK_TEXTS.fr.mission('x')).toBe('Mission : x')
  })
})
