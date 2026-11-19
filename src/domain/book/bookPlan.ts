import type { GuestbookEntryId, GuestId, PhotoId } from '../shared/ids'
import { chapterTitles, splitIntoRanges, type PlanChapter } from './bookChapters'
import {
  byArrival,
  orientationOf,
  type BookCounts,
  type BookInput,
  type BookMessage,
  type BookPhoto,
} from './bookInput'
import { BOOK_MAX_MESSAGES } from './bookLimits'
import type { BookOptionsV2 } from './bookOptionsV2'
import { byProminence, byQuality, findBursts, photoScore, selectPhotos } from './bookSelection'
import { BOOK_STYLE_DEFS } from './bookStyles'
import {
  BOOK_TEMPLATES,
  PHOTO_PAGE_TEMPLATES,
  cropLoss,
  pageCountOf,
  withinCropCeiling,
  type TemplateId,
} from './bookTemplates'

export interface PlanSlot {
  readonly photoId: PhotoId
}

/** A page of the book, ids only. `slots` follow the order of the template's own slots. */
export interface PlanPage {
  readonly template: TemplateId
  readonly slots: readonly PlanSlot[]
  readonly messageIds?: readonly GuestbookEntryId[] | undefined
  /** The chapter an opening page belongs to. */
  readonly chapter?: number | undefined
}

export interface PlanPhotographer {
  readonly guestId: GuestId
  readonly photoCount: number
}

/**
 * The book before any pixel: what `composeBook` decides and what an editor will later change.
 * Ids and numbers only; texts are read again when the pages are drawn.
 */
export interface BookPlan {
  readonly chapters: readonly PlanChapter[]
  readonly pages: readonly PlanPage[]
  readonly selectedCount: number
  /** The evening in numbers, frozen at the first pass. */
  readonly counts: BookCounts
  readonly includedMessages: number
  /** Written messages left in the album export: they did not fit the ceiling. */
  readonly extraMessages: number
  /** Hearts of the retained photographs, frozen; photographs with none are absent. */
  readonly hearts: Readonly<Record<string, number>>
  /** The photographers of the retained photographs, most photographs first. */
  readonly photographers: readonly PlanPhotographer[]
  /** Page numbers of the two sections the contents page lists, or `null`. */
  readonly favouritesPage: number | null
  readonly guestbookPage: number | null
}

export const MESSAGE_PAGE_BUDGET = 900
export const MESSAGE_MIN_COST = 120
export const MESSAGES_PER_PAGE = 6
export const QUOTE_MIN_LENGTH = 40
export const QUOTE_MAX_LENGTH = 280
export const FAVOURITE_MIN_HEARTS = 3
export const FAVOURITES_MIN = 3
export const FAVOURITES_MAX = 5

/** A group of photographs that stays on one page: a lone photograph or a burst chunk. */
interface Unit {
  readonly photos: readonly BookPhoto[]
}

/** The sizes a burst is cut into so each piece has a page of its own (2, 3, 4 or 6 photographs). */
export const chunkBurst = (size: number): number[] => {
  const sizes: number[] = []
  let left = size
  while (left >= 8) {
    sizes.push(6)
    left -= 6
  }
  if (left === 7) sizes.push(4, 3)
  else if (left === 5) sizes.push(3, 2)
  else sizes.push(left)
  return sizes
}

const makeUnits = (photos: readonly BookPhoto[]): Unit[] => {
  const burstOf = new Map<BookPhoto, readonly BookPhoto[]>()
  for (const burst of findBursts(photos)) for (const photo of burst) burstOf.set(photo, burst)
  const units: Unit[] = []
  for (const photo of photos) {
    const burst = burstOf.get(photo)
    if (burst === undefined) units.push({ photos: [photo] })
    else if (burst[0] === photo) {
      let from = 0
      for (const size of chunkBurst(burst.length)) {
        units.push({ photos: burst.slice(from, from + size) })
        from += size
      }
    }
  }
  return units
}

interface Placed {
  readonly template: TemplateId
  readonly photos: readonly BookPhoto[]
}

/** The photographs in the order of the template's slots: the hero slot gets the most prominent one. */
const placePhotos = (template: TemplateId, photos: readonly BookPhoto[]): readonly BookPhoto[] => {
  const slots = BOOK_TEMPLATES[template].slots
  const heroAt = slots.findIndex((slot) => slot.role === 'hero')
  if (heroAt === -1) return photos
  const best = [...photos].sort(byProminence)[0]!
  const others = photos.filter((photo) => photo !== best)
  let next = 0
  return slots.map((_, index) => (index === heroAt ? best : others[next++]!))
}

const totalLoss = (template: TemplateId, placed: readonly BookPhoto[]): number | null => {
  const { slots, span } = BOOK_TEMPLATES[template]
  let total = 0
  for (let i = 0; i < placed.length; i += 1) {
    const loss = cropLoss(placed[i]!, slots[i]!, span)
    if (!withinCropCeiling(loss)) return null
    total += loss
  }
  return total
}

/** The page of 2 or more photographs that crops them least, never repeating the previous page. */
const bestMultiPage = (
  photos: readonly BookPhoto[],
  previous: TemplateId | null,
): Placed | null => {
  let best: Placed | null = null
  let bestLoss = Infinity
  for (const template of PHOTO_PAGE_TEMPLATES[photos.length]!) {
    if (template === previous) continue
    const placed = placePhotos(template, photos)
    const loss = totalLoss(template, placed)
    if (loss !== null && loss < bestLoss) {
      best = { template, photos: placed }
      bestLoss = loss
    }
  }
  return best
}

/** A page for one photograph: `single` (never cropped) or `full` when it fits and the page wants one. */
const singlePage = (photo: BookPhoto, previous: TemplateId | null): Placed => {
  const fits = withinCropCeiling(cropLoss(photo, BOOK_TEMPLATES.full.slots[0]!, 1))
  const strong = photo.highlighted || photoScore(photo) > 0
  const useFull = fits && previous !== 'full' && (strong || previous === 'single')
  return { template: useFull ? 'full' : 'single', photos: [photo] }
}

const pickPage = (
  run: readonly BookPhoto[],
  remaining: number,
  previous: TemplateId | null,
  bigRun: number,
  alone: boolean,
): Placed => {
  const head = run[0]!
  let sizes: number[]
  if (alone || head.highlighted) sizes = []
  else if (bigRun >= 2 && run.slice(0, 2).some((photo) => photoScore(photo) > 0)) sizes = [2]
  else sizes = remaining >= 12 ? [3, 2, 4, 6] : [3, 2, 4]
  for (const size of sizes) {
    if (size > run.length) continue
    const placed = bestMultiPage(run.slice(0, size), previous)
    if (placed !== null) return placed
  }
  return singlePage(head, previous)
}

/**
 * Pages for units in order, greedily: for the next k photographs (3, 2, 4, 6 in that order of
 * preference) the template that crops least, never the previous page's; otherwise one photograph
 * alone. A starred photograph gets a page of its own; after two pages of three or more, a page
 * of one or two if a photograph worth something is waiting; a burst goes in one block.
 * Only `single` may repeat: it is the page that always fits.
 */
const layoutPages = (
  units: readonly Unit[],
  previousTemplate: TemplateId | null,
  firstAlone: boolean,
): PlanPage[] => {
  const out: PlanPage[] = []
  let queue = [...units]
  let previous = previousTemplate
  let bigRun = 0
  let alone = firstAlone
  while (queue.length > 0) {
    const head = queue[0]!
    let placed: Placed | null
    let consumed: number
    if (head.photos.length > 1) {
      placed = bestMultiPage(head.photos, previous)
      if (placed === null) {
        // Nothing fits the burst without cropping too much: it is read as separate photographs.
        queue = [...head.photos.map((photo) => ({ photos: [photo] })), ...queue.slice(1)]
        continue
      }
      consumed = 1
    } else {
      const run: BookPhoto[] = []
      for (const unit of queue) {
        if (unit.photos.length > 1 || run.length === 6) break
        // A starred photograph starts a page of its own, never joins the one before it.
        if (run.length > 0 && unit.photos[0]!.highlighted) break
        run.push(unit.photos[0]!)
      }
      const remaining = queue.reduce((sum, unit) => sum + unit.photos.length, 0)
      placed = pickPage(run, remaining, previous, bigRun, alone)
      consumed = placed.photos.length
    }
    alone = false
    queue = queue.slice(consumed)
    out.push({
      template: placed.template,
      slots: placed.photos.map((photo) => ({ photoId: photo.id })),
    })
    previous = placed.template
    bigRun = placed.photos.length >= 3 ? bigRun + 1 : 0
  }
  return out
}

/** The messages the `messages` pages hold: at most 6 a page and 900 characters of budget. */
const messagePages = (messages: readonly BookMessage[]): GuestbookEntryId[][] => {
  const pages: GuestbookEntryId[][] = []
  let current: GuestbookEntryId[] = []
  let used = 0
  for (const message of messages) {
    const cost = Math.max(MESSAGE_MIN_COST, Math.min(MESSAGE_PAGE_BUDGET, message.length))
    if (
      current.length > 0 &&
      (current.length === MESSAGES_PER_PAGE || used + cost > MESSAGE_PAGE_BUDGET)
    ) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(message.id)
    used += cost
  }
  if (current.length > 0) pages.push(current)
  return pages
}

/**
 * **The** function of spec 26: the pages of a book from frozen numbers.
 *
 * Deterministic: no clock, no random number, and every ordering is total (arrival, then id), so
 * neither the order the rows arrive in nor anything but the arguments can change the result.
 */
export const composeBook = (input: BookInput, options: BookOptionsV2): BookPlan => {
  const selected = selectPhotos(input.photos, options.selection)
  const times = selected.map((photo) => photo.createdAt.getTime())
  const ranges = splitIntoRanges(times)
  const titles = chapterTitles(times, ranges, options.timeZone)
  const style = BOOK_STYLE_DEFS[options.style]
  const messages = options.includeGuestbook
    ? [...input.messages].sort(byArrival).slice(0, BOOK_MAX_MESSAGES)
    : []
  const cited = new Set<GuestbookEntryId>()
  const byId = new Map(selected.map((photo) => [photo.id, photo]))

  const pages: PlanPage[] = []
  const nextPage = (): number => pageCountOf(pages) + 1
  const chapters: PlanChapter[] = []
  const hasOpenings = ranges.length >= 2

  pages.push({ template: 'title', slots: [] })
  if (hasOpenings) pages.push({ template: 'contents', slots: [] })
  pages.push({ template: 'stats', slots: [] })

  /** The longest message of a quotable length not yet cited, cited from now on. */
  const takeQuote = (): BookMessage | undefined => {
    const quotable = messages
      .filter(
        (message) =>
          !cited.has(message.id) &&
          message.length >= QUOTE_MIN_LENGTH &&
          message.length <= QUOTE_MAX_LENGTH,
      )
      .sort((a, b) => b.length - a.length || byArrival(a, b))
    const quote = quotable[0]
    if (quote !== undefined) cited.add(quote.id)
    return quote
  }

  ranges.forEach((range, index) => {
    const group = selected.slice(range.start, range.end)
    chapters.push({
      index,
      startMs: times[range.start]!,
      endMs: times[range.end - 1]!,
      photoCount: group.length,
      title: titles[index]!,
      firstPage: nextPage(),
    })
    if (!hasOpenings) {
      pages.push(...layoutPages(makeUnits(group), null, false))
      return
    }
    const lead = [...group].sort(byProminence)[0]!
    const slots = [{ photoId: lead.id }]
    const wideFits =
      style.wide &&
      orientationOf(lead) === 'landscape' &&
      withinCropCeiling(cropLoss(lead, BOOK_TEMPLATES.wide.slots[0]!, 2))
    let leadTemplate: TemplateId
    if (wideFits) {
      leadTemplate = 'wide'
      pages.push({ template: 'wide', slots, chapter: index })
    } else {
      leadTemplate = singlePage(lead, 'chapter').template
      pages.push({ template: 'chapter', slots: [], chapter: index })
      pages.push({ template: leadTemplate, slots, chapter: index })
    }
    const content = layoutPages(
      makeUnits(group.filter((photo) => photo !== lead)),
      leadTemplate,
      false,
    )
    pages.push(...content)

    // The next opening is a left page, an even one.
    if (index === ranges.length - 1 || nextPage() % 2 === 0) return
    const quote = takeQuote()
    if (quote !== undefined) {
      pages.push({ template: 'quote', slots: [], messageIds: [quote.id] })
      return
    }
    // Else a page with one photograph more: the last page of the chapter, cut in two.
    const last = content[content.length - 1]
    if (last !== undefined && last.slots.length > 1) {
      const photos = last.slots.map((slot) => byId.get(slot.photoId)!).sort(byArrival)
      const split = layoutPages(
        photos.map((photo) => ({ photos: [photo] })),
        content.length > 1 ? content[content.length - 2]!.template : leadTemplate,
        true,
      )
      // One page became `split.length`: the parity flips only when that is even.
      if (split.length % 2 === 0) {
        pages.splice(pages.length - 1, 1, ...split)
        return
      }
    }
    pages.push({ template: 'blank', slots: [] })
  })

  const hearts: Record<string, number> = {}
  for (const photo of selected) if (photo.reactions > 0) hearts[photo.id] = photo.reactions

  const loved = selected.filter((photo) => photo.reactions >= FAVOURITE_MIN_HEARTS)
  let favouritesPage: number | null = null
  if (loved.length >= FAVOURITES_MIN) {
    favouritesPage = nextPage()
    const top = [...loved]
      .sort((a, b) => b.reactions - a.reactions || byQuality(a, b))
      .slice(0, FAVOURITES_MAX)
    pages.push({ template: 'favourites', slots: top.map((photo) => ({ photoId: photo.id })) })
  }

  let guestbookPage: number | null = null
  messagePages(messages.filter((message) => !cited.has(message.id))).forEach((ids, position) => {
    if (position === 0) guestbookPage = nextPage()
    pages.push({ template: 'messages', slots: [], messageIds: ids })
  })

  // An even total, with `thanks` and `end` still to come: the padding goes before them.
  if (pageCountOf(pages) % 2 === 1) pages.push({ template: 'blank', slots: [] })
  pages.push({ template: 'thanks', slots: [] }, { template: 'end', slots: [] })

  const perGuest = new Map<GuestId, number>()
  for (const photo of selected) {
    if (photo.guestId !== null) perGuest.set(photo.guestId, (perGuest.get(photo.guestId) ?? 0) + 1)
  }
  const photographers = [...perGuest]
    .map(([guestId, photoCount]) => ({ guestId, photoCount }))
    .sort((a, b) => b.photoCount - a.photoCount || (a.guestId < b.guestId ? -1 : 1))

  return {
    chapters,
    pages,
    selectedCount: selected.length,
    counts: input.counts,
    includedMessages: messages.length,
    extraMessages: Math.max(0, input.counts.messages - messages.length),
    hearts,
    photographers,
    favouritesPage,
    guestbookPage,
  }
}
