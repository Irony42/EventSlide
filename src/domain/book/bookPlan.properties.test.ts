import { describe, expect, it } from 'vitest'
import type { BookInput, BookPhoto } from './bookInput'
import { byArrival } from './bookInput'
import { BOOK_STYLES, type BookOptionsV2, type BookSelection } from './bookOptionsV2'
import { composeBook, type BookPlan, type PlanPage } from './bookPlan'
import { PRINT_MAX_PAGES, PRINT_MIN_PAGES, planForPrint } from './bookPrint'
import { findBursts } from './bookSelection'
import { BOOK_STYLE_DEFS } from './bookStyles'
import {
  BOOK_TEMPLATES,
  cropLoss,
  pageCountOf,
  withinCropCeiling,
  type TemplateId,
} from './bookTemplates'
import { COUNTS, OPTIONS, generateAlbum, seeded } from './testing/bookFixtures'

const SEEDS = Array.from({ length: 160 }, (_, i) => i + 1)

const SELECTIONS: BookSelection[] = [
  { kind: 'all' },
  { kind: 'best', target: 60 },
  { kind: 'best', target: 120 },
]

interface Case {
  readonly seed: number
  readonly input: BookInput
  readonly options: BookOptionsV2
  readonly plan: BookPlan
}

const cases: Case[] = SEEDS.map((seed) => {
  const { photos, messages } = generateAlbum(seed)
  const random = seeded(seed * 7919)
  const options: BookOptionsV2 = {
    ...OPTIONS,
    style: BOOK_STYLES[Math.floor(random() * 3)]!,
    selection: SELECTIONS[Math.floor(random() * 3)]!,
    includeGuestbook: random() < 0.6,
    timeZone: random() < 0.5 ? 'Europe/Paris' : 'UTC',
  }
  const input: BookInput = { photos, messages, counts: { ...COUNTS, messages: messages.length } }
  return { seed, input, options, plan: composeBook(input, options) }
})

const sizesOf = (input: BookInput): Map<string, BookPhoto> =>
  new Map(input.photos.map((p) => [p.id, p]))

const photoById = (input: BookInput): Map<string, BookPhoto> =>
  new Map(input.photos.map((p) => [p.id, p]))

/** Pages that are not a reminder (`favourites`) and not a chapter's lead photograph. */
const leadIndexes = (pages: readonly PlanPage[]): Set<number> => {
  const leads = new Set<number>()
  pages.forEach((page, i) => {
    if (page.template === 'wide') leads.add(i)
    if (page.template === 'chapter') leads.add(i + 1)
  })
  return leads
}

describe('composeBook properties (160 generated albums)', () => {
  it('generates albums worth testing', () => {
    expect(cases.some((c) => c.plan.chapters.length >= 3)).toBe(true)
    expect(cases.some((c) => c.plan.chapters.length === 1)).toBe(true)
    expect(cases.some((c) => c.plan.pages.some((p) => p.template === 'wide'))).toBe(true)
    expect(cases.some((c) => c.plan.pages.some((p) => p.template === 'quote'))).toBe(true)
    expect(cases.some((c) => c.plan.pages.some((p) => p.template === 'favourites'))).toBe(true)
    expect(cases.some((c) => c.plan.pages.some((p) => p.template === 'strip6'))).toBe(true)
  })

  it('shows every retained photograph exactly once outside the favourites page', () => {
    for (const { seed, plan, input, options } of cases) {
      const shown = plan.pages
        .filter((p) => p.template !== 'favourites')
        .flatMap((p) => p.slots.map((s) => s.photoId))
      expect(new Set(shown).size, `seed ${seed}`).toBe(shown.length)
      expect(shown.length, `seed ${seed}`).toBe(plan.selectedCount)
      if (options.selection.kind === 'all') expect(shown.length).toBe(input.photos.length)
    }
  })

  it('uses no photograph and no message that the input does not hold', () => {
    for (const { seed, plan, input } of cases) {
      const known = photoById(input)
      const messages = new Set(input.messages.map((m) => m.id))
      for (const page of plan.pages) {
        for (const slot of page.slots) expect(known.has(slot.photoId), `seed ${seed}`).toBe(true)
        for (const id of page.messageIds ?? []) expect(messages.has(id), `seed ${seed}`).toBe(true)
      }
    }
  })

  it('has no message when the guest book is off, and none twice when it is on', () => {
    for (const { seed, plan, options } of cases) {
      const ids = plan.pages.flatMap((p) => p.messageIds ?? [])
      if (!options.includeGuestbook) expect(ids, `seed ${seed}`).toEqual([])
      expect(new Set(ids).size, `seed ${seed}`).toBe(ids.length)
      expect(ids.length).toBeLessThanOrEqual(60)
    }
  })

  it('keeps the chronological order between pages (inside a page the hero slot goes to the best photograph), a chapter lead and a burst aside', () => {
    for (const { seed, plan, input } of cases) {
      const known = photoById(input)
      const leads = leadIndexes(plan.pages)
      const shown = plan.pages
        .map((page, i) => ({ page, i }))
        .filter(({ page, i }) => page.template !== 'favourites' && !leads.has(i))
        .filter(({ page }) => page.slots.length > 0)
      const photos = shown.flatMap(({ page }) => page.slots.map((s) => known.get(s.photoId)!))
      // A burst counts as its first member, as the plan places it as a block.
      const bursts = findBursts([...photos].sort(byArrival))
      const first = new Map<BookPhoto, BookPhoto>()
      for (const burst of bursts) for (const p of burst) first.set(p, burst[0]!)
      const keyOf = (p: BookPhoto): BookPhoto => first.get(p) ?? p
      let last: BookPhoto | null = null
      for (const { page } of shown) {
        const keys = page.slots.map((s) => keyOf(known.get(s.photoId)!)).sort(byArrival)
        if (last !== null) {
          expect(byArrival(last, keys[0]!), `seed ${seed}`).toBeLessThanOrEqual(0)
        }
        last = keys[keys.length - 1]!
      }
    }
  })

  it('never crops a photograph by more than 20 %', () => {
    for (const { seed, plan, input } of cases) {
      const known = photoById(input)
      for (const page of plan.pages) {
        const { slots, span } = BOOK_TEMPLATES[page.template]
        page.slots.forEach((slot, i) => {
          const loss = cropLoss(known.get(slot.photoId)!, slots[i]!, span)
          expect(withinCropCeiling(loss), `seed ${seed} ${page.template} slot ${i}: ${loss}`).toBe(
            true,
          )
        })
      }
    }
  })

  it('repeats a page template only for the single that always fits (and blank, messages)', () => {
    for (const { seed, plan } of cases) {
      const allowed: TemplateId[] = ['single', 'messages', 'blank']
      plan.pages.forEach((page, i) => {
        if (i > 0 && page.template === plan.pages[i - 1]!.template) {
          expect(allowed, `seed ${seed} page ${i} ${page.template}`).toContain(page.template)
        }
      })
    }
  })

  it('has an even number of pages and ends with `end`, after `thanks`', () => {
    for (const { seed, plan } of cases) {
      expect(pageCountOf(plan.pages) % 2, `seed ${seed}`).toBe(0)
      expect(plan.pages.at(-1)!.template).toBe('end')
      expect(plan.pages.at(-2)!.template).toBe('thanks')
      expect(plan.pages.filter((p) => p.template === 'end')).toHaveLength(1)
    }
  })

  it('opens every chapter on an even page, and names that page in the chapter', () => {
    for (const { seed, plan } of cases) {
      let page = 1
      const openings: number[] = []
      for (const p of plan.pages) {
        if (p.template === 'chapter' || p.template === 'wide') openings.push(page)
        page += BOOK_TEMPLATES[p.template].span
      }
      for (const n of openings) expect(n % 2, `seed ${seed}`).toBe(0)
      if (plan.chapters.length >= 2) {
        expect(openings, `seed ${seed}`).toEqual(plan.chapters.map((c) => c.firstPage))
      } else {
        expect(openings).toEqual([])
      }
    }
  })

  it('never puts two blank pages in a row', () => {
    for (const { seed, plan } of cases) {
      plan.pages.forEach((page, i) => {
        if (i > 0 && page.template === 'blank') {
          expect(plan.pages[i - 1]!.template, `seed ${seed} page ${i}`).not.toBe('blank')
        }
      })
    }
  })

  it('keeps the chapters between 6 photographs and 8 chapters (a single one aside)', () => {
    for (const { seed, plan } of cases) {
      expect(plan.chapters.length).toBeLessThanOrEqual(8)
      expect(
        plan.chapters.reduce((n, c) => n + c.photoCount, 0),
        `seed ${seed}`,
      ).toBe(plan.selectedCount)
      if (plan.chapters.length > 1) {
        for (const chapter of plan.chapters) expect(chapter.photoCount).toBeGreaterThanOrEqual(6)
      }
    }
  })

  it('is a function of its arguments: twice the same plan, whatever order the rows arrive in', () => {
    for (const { seed, input, options, plan } of cases.filter((c) => c.seed % 4 === 0)) {
      expect(composeBook(input, options), `seed ${seed}`).toEqual(plan)
      const shuffled: BookInput = {
        ...input,
        photos: [...input.photos].reverse(),
        messages: [...input.messages].reverse(),
      }
      expect(composeBook(shuffled, options), `seed ${seed}`).toEqual(plan)
    }
  })

  it('does not depend on the order of rows that share an instant', () => {
    const { photos, messages } = generateAlbum(5)
    const instant = new Date(photos[0]!.createdAt)
    const tied = photos.slice(0, 8).map((p) => ({ ...p, createdAt: instant }))
    const rest = photos.slice(8)
    const input = (list: BookPhoto[]): BookInput => ({
      photos: [...list, ...rest],
      messages,
      counts: COUNTS,
    })
    const options = { ...OPTIONS, includeGuestbook: true }
    expect(composeBook(input([...tied].reverse()), options)).toEqual(
      composeBook(input(tied), options),
    )
  })
})

describe('the printer version of every generated plan', () => {
  it('has no `wide`, an even page count of at least 24, and at most 200 or no version', () => {
    for (const { seed, plan, options, input } of cases) {
      const print = planForPrint(plan.pages, options.style, sizesOf(input))
      if (print.kind === 'tooManyPages') {
        expect(print.pageCount, `seed ${seed}`).toBeGreaterThan(PRINT_MAX_PAGES)
        continue
      }
      expect(
        print.pages.some((p) => p.template === 'wide'),
        `seed ${seed}`,
      ).toBe(false)
      const count = pageCountOf(print.pages)
      expect(count % 2).toBe(0)
      expect(count).toBeGreaterThanOrEqual(PRINT_MIN_PAGES)
      expect(count).toBeLessThanOrEqual(PRINT_MAX_PAGES)
      expect(print.pages.at(-1)!.template).toBe('end')
      // The same photographs on the same pages: only the wide ones changed.
      const ids = (pages: readonly PlanPage[]) =>
        pages
          .filter((p) => p.template !== 'favourites')
          .flatMap((p) => p.slots.map((s) => s.photoId))
      expect(ids(print.pages)).toEqual(ids(plan.pages))
    }
  })

  it('never crops a photograph past the ceiling in the printer version either', () => {
    for (const { seed, plan, options, input } of cases) {
      const print = planForPrint(plan.pages, options.style, sizesOf(input))
      if (print.kind !== 'ready') continue
      const known = photoById(input)
      for (const page of print.pages) {
        const { slots, span } = BOOK_TEMPLATES[page.template]
        page.slots.forEach((slot, i) => {
          const loss = cropLoss(known.get(slot.photoId)!, slots[i]!, span)
          expect(withinCropCeiling(loss), `seed ${seed} ${page.template}: ${loss}`).toBe(true)
        })
      }
    }
  })

  it('keeps the openings on even pages', () => {
    for (const { seed, plan, options, input } of cases) {
      const print = planForPrint(plan.pages, options.style, sizesOf(input))
      if (print.kind !== 'ready') continue
      let page = 1
      for (const p of print.pages) {
        if (p.template === 'chapter') expect(page % 2, `seed ${seed}`).toBe(0)
        page += BOOK_TEMPLATES[p.template].span
      }
    }
  })

  it('only the styles that allow a wide opening ever produce one', () => {
    for (const { plan, options } of cases) {
      if (!BOOK_STYLE_DEFS[options.style].wide) {
        expect(plan.pages.some((p) => p.template === 'wide')).toBe(false)
      }
    }
  })
})
