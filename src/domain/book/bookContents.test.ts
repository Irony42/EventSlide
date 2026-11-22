import { describe, expect, it } from 'vitest'
import { chapterNumeral, contentsEntries } from './bookContents'
import type { BookPlan } from './bookPlan'

const plan = (over: Partial<BookPlan>): BookPlan =>
  ({
    chapters: [
      {
        index: 0,
        startMs: 0,
        endMs: 1,
        photoCount: 10,
        title: { weekday: null, moment: 'evening', continued: false },
        firstPage: 4,
      },
    ],
    pages: [],
    selectedCount: 10,
    counts: { photos: 10, photographers: 1, hearts: 0, messages: 0, voices: 0, videos: 0 },
    includedMessages: 0,
    extraMessages: 0,
    hearts: {},
    photographers: [],
    favouritesPage: null,
    guestbookPage: null,
    ...over,
  }) as BookPlan

describe('chapterNumeral', () => {
  it('writes Roman numerals for the chapters the plan can have, and a number beyond', () => {
    expect(chapterNumeral(0)).toBe('I')
    expect(chapterNumeral(7)).toBe('VIII')
    expect(chapterNumeral(8)).toBe('9')
  })
})

describe('contentsEntries', () => {
  it('lists the chapters with their first page', () => {
    expect(contentsEntries(plan({}), 'fr')).toEqual([{ label: 'I · La soirée', page: 4 }])
  })

  it('adds the favourites and the guest book when the plan has them, in the book language', () => {
    const lines = contentsEntries(plan({ favouritesPage: 9, guestbookPage: 10 }), 'fr')
    expect(lines.slice(1)).toEqual([
      { label: 'Les coups de cœur', page: 9 },
      { label: "Le livre d'or", page: 10 },
    ])
  })
})
