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
