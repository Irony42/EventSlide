import { describe, expect, it } from 'vitest'
import type { BookInput, BookMessage, BookPhoto } from './bookInput'
import type { BookOptionsV2 } from './bookOptionsV2'
import { chunkBurst, composeBook, type PlanPage } from './bookPlan'
import { pageCountOf } from './bookTemplates'
import { COUNTS, MINUTE, OPTIONS, T0, guest, makeMessage, makePhoto } from './testing/bookFixtures'

const compose = (
  photos: BookPhoto[],
  options: Partial<BookOptionsV2> = {},
  messages: BookMessage[] = [],
  counts = COUNTS,
) => composeBook({ photos, messages, counts } satisfies BookInput, { ...OPTIONS, ...options })

const templates = (pages: readonly PlanPage[]): string[] => pages.map((p) => p.template)

const square = { width: 1000, height: 1000 }
const portrait = { width: 1000, height: 1500 }

/** `n` photographs a minute apart from `start`, each of its own guest (so none is a burst). */
const run = (n: number, start: number, over: (i: number) => Partial<BookPhoto> = () => ({})) =>
  Array.from({ length: n }, (_, i) =>
    makePhoto({ minute: start + i, guestId: guest(start + i), ...over(i) }),
  )

/** Three chapters of eight photographs, an hour and a half apart. */
const threeChapters = (over: (i: number) => Partial<BookPhoto> = () => ({})) => [
  ...run(8, 0, over),
  ...run(8, 100, over),
  ...run(8, 200, over),
]

describe('composeBook: shape', () => {
  it('is title, stats, thanks, end for an album with no photograph', () => {
    const plan = compose([])
    expect(templates(plan.pages)).toEqual(['title', 'stats', 'thanks', 'end'])
    expect(plan.chapters).toEqual([])
    expect(plan.selectedCount).toBe(0)
  })

  it('is one chapter, with no opening and no contents, under 12 photographs', () => {
    const plan = compose(run(11, 0))
    expect(plan.chapters).toHaveLength(1)
    expect(templates(plan.pages)).not.toContain('contents')
    expect(templates(plan.pages)).not.toContain('chapter')
    expect(templates(plan.pages).slice(0, 2)).toEqual(['title', 'stats'])
    expect(plan.chapters[0]!.firstPage).toBe(3)
  })

  it('is one chapter too when the silences leave 12 photographs or more in a single run', () => {
    const plan = compose(run(20, 0))
    expect(plan.chapters).toHaveLength(1)
    expect(templates(plan.pages)).not.toContain('chapter')
  })

  it('opens each chapter on an even page, after title, contents and stats', () => {
    const plan = compose(threeChapters())
    expect(templates(plan.pages).slice(0, 3)).toEqual(['title', 'contents', 'stats'])
    let page = 1
    const openings: number[] = []
    for (const p of plan.pages) {
      if (p.template === 'chapter' || p.template === 'wide') openings.push(page)
      page += p.template === 'wide' ? 2 : 1
    }
    expect(openings).toHaveLength(3)
    expect(openings.every((n) => n % 2 === 0)).toBe(true)
    expect(plan.chapters.map((c) => c.firstPage)).toEqual(openings)
  })

  it('ends with thanks then end, on an even total', () => {
    for (const count of [0, 5, 11, 24, 40]) {
      const plan = compose(run(count, 0))
      expect(templates(plan.pages).slice(-2)).toEqual(['thanks', 'end'])
      expect(pageCountOf(plan.pages) % 2).toBe(0)
    }
  })

  it('puts the padding blank before thanks, never after', () => {
    const plan = compose(run(1, 0)) // title, stats, single = 3 pages: one blank
    expect(templates(plan.pages)).toEqual(['title', 'stats', 'single', 'blank', 'thanks', 'end'])
  })
})

describe('composeBook: chapter openings', () => {
  it('opens a chapter with the starred photograph, then the best scored, then the oldest', () => {
    const photos = threeChapters((i) => ({ reactions: i === 3 ? 4 : 0, highlighted: i === 5 }))
    const plan = compose(photos)
    const opening = plan.pages.find((p) => p.template === 'chapter')!
    const lead = plan.pages[plan.pages.indexOf(opening) + 1]!
    expect(lead.slots[0]!.photoId).toBe(photos[5]!.id)
    expect(lead.chapter).toBe(0)

    const unstarredPhotos = threeChapters((i) => ({ reactions: i === 3 ? 4 : 0 }))
    const unstarred = compose(unstarredPhotos)
    const first = unstarred.pages.find((p) => p.template === 'chapter')!
    expect(unstarred.pages[unstarred.pages.indexOf(first) + 1]!.slots[0]!.photoId).toBe(
      unstarredPhotos[3]!.id,
    )
  })

  it('opens on a double-page photograph for a style that allows it, when the lead is wide enough', () => {
    const wide = { width: 1920, height: 1080 }
    const plan = compose(
      threeChapters(() => wide),
      { style: 'magazine' },
    )
    expect(templates(plan.pages)).toContain('wide')
    const at = plan.pages.findIndex((p) => p.template === 'wide')
    expect(plan.pages[at]).toMatchObject({ chapter: 0 })
    expect(plan.pages[at - 1]!.template).toBe('stats')
    expect(templates(plan.pages)).not.toContain('chapter')
  })

  it('never opens on a double page in Classique, nor for a lead that is not wide enough', () => {
    const wide = { width: 1920, height: 1080 }
    expect(
      templates(
        compose(
          threeChapters(() => wide),
          { style: 'classique' },
        ).pages,
      ),
    ).not.toContain('wide')
    expect(
      templates(
        compose(
          threeChapters(() => ({ width: 1500, height: 1000 })),
          { style: 'magazine' },
        ).pages,
      ),
    ).not.toContain('wide')
    expect(
      templates(
        compose(
          threeChapters(() => portrait),
          { style: 'souvenir' },
        ).pages,
      ),
    ).not.toContain('wide')
  })

  it('draws a lead that fits the page whole as `full`, otherwise `single`', () => {
    const squares = compose(threeChapters(() => ({ ...square, highlighted: true })))
    const at = squares.pages.findIndex((p) => p.template === 'chapter')
    expect(squares.pages[at + 1]!.template).toBe('full')
    const landscapes = compose(threeChapters())
    const first = landscapes.pages.findIndex((p) => p.template === 'chapter')
    expect(landscapes.pages[first + 1]!.template).toBe('single')
  })
})

describe('composeBook: pages of photographs', () => {
  it('gives a starred photograph a page of its own', () => {
    const photos = run(10, 0, (i) => ({ highlighted: i === 4 }))
    const plan = compose(photos)
    const page = plan.pages.find((p) => p.slots.some((s) => s.photoId === photos[4]!.id))!
    expect(page.slots).toHaveLength(1)
  })

  it('uses a hero page for three landscapes, hero slot to the best scored', () => {
    const photos = run(3, 0, (i) => ({ reactions: i === 2 ? 5 : 0 }))
    const plan = compose(photos)
    const page = plan.pages.find((p) => p.template === 'heroTwo')!
    expect(page.slots[0]!.photoId).toBe(photos[2]!.id)
    expect(page.slots.slice(1).map((s) => s.photoId)).toEqual([photos[0]!.id, photos[1]!.id])
  })

  it('never repeats a page, except the single that always fits', () => {
    const plan = compose(run(60, 0))
    const t = templates(plan.pages)
    for (let i = 1; i < t.length; i += 1) {
      if (t[i] === t[i - 1]) expect(['single', 'blank', 'messages']).toContain(t[i])
    }
  })

  it('picks a different page that fits over repeating the previous one', () => {
    const plan = compose(run(6, 0))
    expect(
      templates(plan.pages)
        .filter((t) => t !== 'title' && t !== 'stats')
        .slice(0, 3),
    ).toEqual(['heroTwo', 'twoStack', 'single'])
  })

  it('puts portraits side by side and landscapes one above the other', () => {
    expect(templates(compose(run(2, 0, () => portrait)).pages)).toContain('twoSide')
    expect(templates(compose(run(2, 0, () => ({ width: 1600, height: 1000 }))).pages)).toContain(
      'twoStack',
    )
  })

  it('puts a burst of six squares on one strip, four on a grid', () => {
    const burst = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...makePhoto({ ...square, guestId: guest(1) }),
        createdAt: new Date(T0 + i * 4000),
      }))
    const strip = compose(burst(6))
    expect(strip.pages.find((p) => p.template === 'strip6')!.slots).toHaveLength(6)
    expect(templates(compose(burst(4)).pages)).toContain('grid4')
  })

  it('cuts a long burst into pieces that each have a page', () => {
    const burst = Array.from({ length: 13 }, (_, i) => ({
      ...makePhoto({ ...square, guestId: guest(1) }),
      createdAt: new Date(T0 + i * 4000),
    }))
    const plan = compose(burst)
    const sizes = plan.pages.filter((p) => p.slots.length > 0).map((p) => p.slots.length)
    expect(sizes.reduce((a, b) => a + b)).toBe(13)
    expect(plan.pages.find((p) => p.template === 'strip6')!.slots).toHaveLength(6)
  })

  it('reads a burst as separate photographs when no page fits it without cropping', () => {
    const burst = Array.from({ length: 3 }, (_, i) => ({
      ...makePhoto({ width: 3000, height: 1000, guestId: guest(1) }),
      createdAt: new Date(T0 + i * 4000),
    }))
    const plan = compose(burst)
    expect(plan.pages.filter((p) => p.slots.length > 0).every((p) => p.slots.length < 3)).toBe(true)
    expect(plan.pages.flatMap((p) => p.slots)).toHaveLength(3)
  })

  it('lets a burst of two take a pair page even after identical pages ban its first choice', () => {
    const pair = (start: number) =>
      [0, 1].map((i) => ({
        ...makePhoto({ ...portrait, guestId: guest(start) }),
        createdAt: new Date(T0 + start * MINUTE + i * 4000),
      }))
    const plan = compose([...pair(1), ...pair(2)])
    const twoSide = plan.pages.filter((p) => p.template === 'twoSide').length
    expect(twoSide).toBeLessThanOrEqual(1)
    expect(plan.pages.flatMap((p) => p.slots)).toHaveLength(4)
  })

  it('follows two crowded pages with a page of one or two when a scored photograph waits', () => {
    const landscape = { width: 1500, height: 1000 }
    const sequence = (scored: boolean) => [
      ...run(3, 0, () => landscape), // heroTwo
      ...run(4, 10, () => square), // grid4
      ...run(3, 20, (i) => ({ ...landscape, reactions: scored && i === 0 ? 2 : 0 })),
    ]
    const sizes = (plan: ReturnType<typeof compose>) =>
      plan.pages.filter((p) => p.slots.length > 0).map((p) => p.slots.length)
    expect(sizes(compose(sequence(true)))).toEqual([3, 4, 2, 1])
    expect(sizes(compose(sequence(false)))).toEqual([3, 4, 3])
  })

  it('alternates single and full for square photographs that are worth a page', () => {
    const photos = run(3, 0, () => ({ ...square, highlighted: true }))
    expect(templates(compose(photos).pages).filter((t) => t === 'full' || t === 'single')).toEqual([
      'full',
      'single',
      'full',
    ])
  })

  it('lets a square without a score take a full page after a single', () => {
    const photos = [
      makePhoto({ minute: 0, highlighted: true, ...portrait }),
      makePhoto({ minute: 1, ...square }),
    ]
    expect(templates(compose(photos).pages)).toContain('full')
  })
})

describe('composeBook: the parity of the next opening', () => {
  const between = (plan: ReturnType<typeof compose>): string[] => {
    const openings = plan.pages.flatMap((p, i) => (p.template === 'chapter' ? [i] : []))
    return templates(plan.pages.slice(openings[0]! + 1, openings[1]!))
  }

  it('cuts the last page of a chapter in two, when that is what makes the next opening even', () => {
    const plan = compose([...run(9, 0), ...run(8, 100)])
    expect(between(plan)).toEqual(['single', 'heroTwo', 'twoStack', 'single', 'twoStack'])
  })

  it('falls back to a blank page when cutting the last page would not help', () => {
    const burst = Array.from({ length: 6 }, (_, i) => ({
      ...makePhoto({ ...square, guestId: guest(500) }),
      createdAt: new Date(T0 + 10 * MINUTE + i * 4000),
    }))
    const plan = compose([makePhoto({ minute: 0 }), ...burst, ...run(8, 100)])
    expect(between(plan)).toEqual(['single', 'strip6', 'blank'])
  })

  it('never cuts a burst block to fix the parity: a blank page instead', () => {
    const burst = Array.from({ length: 4 }, (_, i) => ({
      ...makePhoto({ ...square, guestId: guest(500) }),
      createdAt: new Date(T0 + 20 * MINUTE + i * 4000),
    }))
    const plan = compose([...run(6, 0), ...burst, ...run(8, 100)])
    const pages = between(plan)
    expect(pages.slice(-2)).toEqual(['grid4', 'blank'])
    const grid = plan.pages.find((p) => p.template === 'grid4')!
    expect(grid.slots).toHaveLength(4)
  })

  it('falls back to a blank page when the last page holds a single photograph', () => {
    const plan = compose([...run(7, 0), ...run(8, 100)])
    expect(between(plan).at(-1)).toBe('blank')
  })
})

describe('composeBook: phone portraits', () => {
  const phone = { width: 1500, height: 2000 }

  it('lays three portraits on a hero page and its mirror in turn, and a burst of four on a grid of 3:4 cells', () => {
    expect(templates(compose(run(3, 0, () => phone)).pages)).toContain('portraitHero')
    expect(templates(compose(run(6, 0, () => phone)).pages)).toEqual(
      expect.arrayContaining(['threePortraits', 'portraitHero']),
    )
    const burst = Array.from({ length: 4 }, (_, i) => ({
      ...makePhoto({ ...phone, guestId: guest(1) }),
      createdAt: new Date(T0 + i * 4000),
    }))
    expect(templates(compose(burst).pages)).toContain('grid4Portrait')
  })

  it('does not end up mostly with single pages for an album of 3:4 portraits', () => {
    // 120 photographs: the six first templates took no 3:4 portrait under 20 % crop and the plan was
    // single page after single page. With the portrait pages none is (measured: 0 of 40); the threshold leaves room for a template change.
    const plan = compose(run(120, 0, (i) => ({ ...phone, guestId: guest(i % 7) })))
    const photoPages = plan.pages.filter((p) => p.slots.length > 0 && p.template !== 'favourites')
    const singles = photoPages.filter((p) => p.template === 'single' || p.template === 'full')
    expect(singles.length / photoPages.length).toBeLessThan(0.1)
  })

  it('stays below half single pages for a mixed phone album (measured: 36 %): portraits, a few landscapes, squares', () => {
    const sizes = [
      phone,
      phone,
      phone,
      { width: 1500, height: 1000 },
      phone,
      { width: 1000, height: 1000 },
    ]
    const plan = compose(
      run(120, 0, (i) => ({ ...sizes[i % sizes.length]!, guestId: guest(i % 11) })),
    )
    const photoPages = plan.pages.filter((p) => p.slots.length > 0 && p.template !== 'favourites')
    const singles = photoPages.filter((p) => p.template === 'single' || p.template === 'full')
    expect(singles.length / photoPages.length).toBeLessThan(0.45)
  })
})

describe('composeBook: Magazine bleeds', () => {
  const phone = { width: 1500, height: 2000 }
  const strong = () => run(8, 0, (i) => ({ ...phone, highlighted: i % 2 === 0 }))

  it('gives a strong portrait a full page in Magazine, where Classique contains it on a single page', () => {
    const magazine = templates(compose(strong(), { style: 'magazine' }).pages)
    const classique = templates(compose(strong(), { style: 'classique' }).pages)

    expect(magazine).toContain('full')
    expect(classique).not.toContain('full')
  })

  it('does not bleed a photograph that would lose more than 30 %', () => {
    const tall = run(4, 0, () => ({ width: 1000, height: 2000, highlighted: true }))

    expect(templates(compose(tall, { style: 'magazine' }).pages)).not.toContain('full')
  })
})

describe('composeBook: guest book', () => {
  const longMessage = (n: number, length: number, minute = n) => makeMessage({ n, length, minute })

  it('puts no message anywhere when the guest book is off', () => {
    const plan = compose(threeChapters(), { includeGuestbook: false }, [longMessage(1, 200)])
    expect(plan.pages.every((p) => p.messageIds === undefined)).toBe(true)
    expect(plan.includedMessages).toBe(0)
  })

  it('cites the longest quotable message between chapters when it needs a page', () => {
    const photos = [...run(7, 0), ...run(8, 100), ...run(8, 200)]
    const messages = [
      longMessage(1, 39),
      longMessage(2, 40),
      longMessage(3, 280),
      longMessage(4, 281),
      longMessage(5, 100),
    ]
    const plan = compose(photos, { includeGuestbook: true }, messages)
    const quotes = plan.pages.filter((p) => p.template === 'quote')
    expect(quotes.length).toBeGreaterThanOrEqual(1)
    expect(quotes[0]!.messageIds).toEqual(['m00003'])
    const cited = quotes.flatMap((p) => p.messageIds!)
    const listed = plan.pages.filter((p) => p.template === 'messages').flatMap((p) => p.messageIds!)
    for (const id of cited) expect(listed).not.toContain(id)
    expect([...cited, ...listed].sort()).toEqual(messages.map((m) => m.id).sort())
  })

  it('lists the messages in order, filled by budget of 900 characters a page', () => {
    const messages = [400, 450, 500].map((length, n) => longMessage(n + 1, length))
    const plan = compose(run(3, 0), { includeGuestbook: true }, messages)
    const pages = plan.pages.filter((p) => p.template === 'messages')
    expect(pages.map((p) => p.messageIds!.length)).toEqual([2, 1])
    expect(plan.guestbookPage).not.toBeNull()
  })

  it('fills a page to exactly 900 characters, and not beyond', () => {
    const messages = [450, 450, 1].map((length, n) => longMessage(n + 1, length))
    const plan = compose(run(3, 0), { includeGuestbook: true }, messages)
    expect(
      plan.pages.filter((p) => p.template === 'messages').map((p) => p.messageIds!.length),
    ).toEqual([2, 1])
  })

  it('charges at least 120 a message and holds four a page', () => {
    const messages = Array.from({ length: 15 }, (_, n) => longMessage(n + 1, 5))
    const plan = compose(run(3, 0), { includeGuestbook: true }, messages)
    expect(
      plan.pages.filter((p) => p.template === 'messages').map((p) => p.messageIds!.length),
    ).toEqual([4, 4, 4, 3])
  })

  it('stays within the 900 budget even for a message that alone is larger than a page', () => {
    const plan = compose(run(3, 0), { includeGuestbook: true }, [
      longMessage(1, 2000),
      longMessage(2, 10),
    ])
    expect(
      plan.pages.filter((p) => p.template === 'messages').map((p) => p.messageIds!.length),
    ).toEqual([1, 1])
  })

  it('keeps the first 60 in order and counts the rest for the closing page', () => {
    const messages = Array.from({ length: 70 }, (_, n) => longMessage(n + 1, 100, 70 - n))
    const plan = compose(run(3, 0), { includeGuestbook: true }, messages, {
      ...COUNTS,
      messages: 70,
    })
    expect(plan.includedMessages).toBe(60)
    expect(plan.extraMessages).toBe(10)
    const listed = plan.pages.filter((p) => p.template === 'messages').flatMap((p) => p.messageIds!)
    expect(listed).toHaveLength(60)
    // the 60 oldest: minute 1..60 are messages 70 down to 11
    expect(listed).not.toContain('m00001')
    expect(listed).toContain('m00011')
  })

  it('counts the messages left in the export, from the uncapped count of the snapshot', () => {
    const withBook = compose(run(3, 0), { includeGuestbook: true }, [], { ...COUNTS, messages: 5 })
    expect(withBook.extraMessages).toBe(5)
    expect(
      compose(run(3, 0), { includeGuestbook: true }, [], { ...COUNTS, messages: 0 }).extraMessages,
    ).toBe(0)
  })

  it('says nothing about left-out messages when the guest book is off', () => {
    expect(compose(run(3, 0), {}, [], { ...COUNTS, messages: 5 }).extraMessages).toBe(0)
  })

  it('does not fix the parity with a blank page if a quote exists but with the book still shorter', () => {
    const plan = compose(threeChapters(), { includeGuestbook: true }, [longMessage(1, 100)])
    expect(pageCountOf(plan.pages) % 2).toBe(0)
  })
})

describe('composeBook: favourites and numbers', () => {
  it('adds the loved photographs again, the most loved first, up to five', () => {
    const photos = run(10, 0, (i) => ({ reactions: i < 7 ? 3 + i : 2 }))
    const plan = compose(photos)
    const page = plan.pages.find((p) => p.template === 'favourites')!
    expect(page.slots.map((s) => s.photoId)).toEqual([6, 5, 4, 3, 2].map((i) => photos[i]!.id))
    expect(plan.favouritesPage).not.toBeNull()
  })

  it('makes a favourites page of exactly three when exactly three have three hearts', () => {
    const plan = compose(run(10, 0, (i) => ({ reactions: i < 3 ? 3 : 2 })))
    expect(plan.pages.find((p) => p.template === 'favourites')!.slots).toHaveLength(3)
  })

  it('makes no favourites page under three photographs with three hearts', () => {
    const plan = compose(run(10, 0, (i) => ({ reactions: i < 2 ? 9 : 2 })))
    expect(templates(plan.pages)).not.toContain('favourites')
    expect(plan.favouritesPage).toBeNull()
  })

  it('freezes the hearts and counts the photographers of the retained photographs', () => {
    const photos = [
      makePhoto({ minute: 0, guestId: guest(1), reactions: 4 }),
      makePhoto({ minute: 1, guestId: guest(2), reactions: 0 }),
      makePhoto({ minute: 2, guestId: guest(1) }),
      makePhoto({ minute: 3, guestId: guest(3) }),
      makePhoto({ minute: 4, guestId: null }),
    ]
    const plan = compose(photos, {}, [], { ...COUNTS, photos: 5, hearts: 4 })
    expect(plan.hearts).toEqual({ [photos[0]!.id]: 4 })
    expect(plan.photographers).toEqual([
      { guestId: guest(1), photoCount: 2 },
      { guestId: guest(2), photoCount: 1 },
      { guestId: guest(3), photoCount: 1 },
    ])
    expect(plan.counts.hearts).toBe(4)
    expect(plan.selectedCount).toBe(5)
  })

  it('counts the evening on the event, not on the selection', () => {
    const photos = run(100, 0)
    const plan = compose(photos, { selection: { kind: 'best', target: 60 } }, [], {
      ...COUNTS,
      photos: 100,
    })
    expect(plan.selectedCount).toBe(60)
    expect(plan.counts.photos).toBe(100)
  })
})

describe('chunkBurst', () => {
  it('cuts into pieces of 2, 3, 4 or 6', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(chunkBurst)).toEqual([
      [2],
      [3],
      [4],
      [3, 2],
      [6],
      [4, 3],
      [6, 2],
      [6, 3],
      [6, 4],
      [6, 3, 2],
      [6, 6],
      [6, 4, 3],
    ])
  })
})
