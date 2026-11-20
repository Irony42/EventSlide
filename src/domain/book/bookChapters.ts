import type { EventLanguage } from '../events/eventLanguage'
import { BOOK_TEXTS } from './bookTexts'
import { dayMomentOf, formatClock, localParts, partyDayOf, type DayMoment } from './bookTime'

/** Two consecutive photographs this far apart (or more) end a chapter. */
export const CHAPTER_GAP_MS = 45 * 60_000
/** A chapter with fewer photographs is merged into its nearest neighbour. */
export const MIN_CHAPTER_PHOTOS = 6
export const MAX_CHAPTERS = 8
/** Under this many photographs the book is one chapter, with no opening and no contents. */
export const MIN_PHOTOS_FOR_CHAPTERS = 12

/** A run of photographs by position: `end` is exclusive. */
export interface ChapterRange {
  readonly start: number
  readonly end: number
}

const sizeOf = (range: ChapterRange): number => range.end - range.start

/**
 * Where the chapters of a chronological list of arrival instants (ms) fall.
 *
 * Cut at gaps of 45 minutes or more; a chapter under 6 photographs joins its nearest
 * neighbour in time (the previous one on a tie); at most 8 chapters remain, the two closest
 * neighbours being merged until they do. Under 12 photographs: one chapter.
 */
export const splitIntoRanges = (times: readonly number[]): readonly ChapterRange[] => {
  if (times.length === 0) return []
  if (times.length < MIN_PHOTOS_FOR_CHAPTERS) return [{ start: 0, end: times.length }]

  let ranges: ChapterRange[] = []
  let start = 0
  for (let i = 1; i < times.length; i += 1) {
    if (times[i]! - times[i - 1]! >= CHAPTER_GAP_MS) {
      ranges.push({ start, end: i })
      start = i
    }
  }
  ranges.push({ start, end: times.length })

  /** The silence between a range and the next one. */
  const gapAfter = (index: number): number =>
    times[ranges[index + 1]!.start]! - times[ranges[index]!.end - 1]!
  const merge = (index: number): void => {
    // Merge `index` with `index + 1`.
    const joined = { start: ranges[index]!.start, end: ranges[index + 1]!.end }
    ranges = [...ranges.slice(0, index), joined, ...ranges.slice(index + 2)]
  }

  for (;;) {
    const small = ranges.findIndex((range) => sizeOf(range) < MIN_CHAPTER_PHOTOS)
    if (small === -1) break
    const towardsPrevious =
      small > 0 && (small === ranges.length - 1 || gapAfter(small - 1) <= gapAfter(small))
    merge(towardsPrevious ? small - 1 : small)
  }

  while (ranges.length > MAX_CHAPTERS) {
    let closest = 0
    for (let i = 1; i < ranges.length - 1; i += 1) {
      if (gapAfter(i) < gapAfter(closest)) closest = i
    }
    merge(closest)
  }
  return ranges
}

/** A chapter's name as data: words are chosen when the pages are drawn, in the book's language. */
export interface ChapterTitle {
  /** 0 = Sunday; `null` when the photographs span a single party day. */
  readonly weekday: number | null
  readonly moment: DayMoment
  /** The same name as the chapter before: "La soirée, suite". */
  readonly continued: boolean
}

export interface PlanChapter {
  readonly index: number
  readonly startMs: number
  readonly endMs: number
  readonly photoCount: number
  readonly title: ChapterTitle
  /** Page number of the opening, filled by `composeBook`. */
  readonly firstPage: number
}

/** The chapters of chronological photographs (arrival instants, ms) in the host's zone. */
export const chapterTitles = (
  times: readonly number[],
  ranges: readonly ChapterRange[],
  timeZone: string,
): readonly ChapterTitle[] => {
  const days = new Set(times.map((ms) => partyDayOf(localParts(ms, timeZone)).dayNumber))
  const severalDays = days.size > 1
  const titles: ChapterTitle[] = []
  let previous = ''
  for (const range of ranges) {
    const parts = localParts(times[range.start]!, timeZone)
    const moment = dayMomentOf(parts.hour)
    const weekday = severalDays ? partyDayOf(parts).weekday : null
    const name = `${weekday ?? '-'}/${moment}`
    titles.push({ weekday, moment, continued: name === previous })
    previous = name
  }
  return titles
}

export const chapterTitleText = (title: ChapterTitle, language: EventLanguage): string => {
  const texts = BOOK_TEXTS[language]
  const base =
    title.weekday === null
      ? texts.moments[title.moment].title
      : texts.withDay(texts.weekdays[title.weekday]!, texts.moments[title.moment].inline)
  return title.continued ? texts.continued(base) : base
}

/** "de 19 h 30 à 22 h 05 · 84 photos". */
export const chapterSubtitleText = (
  chapter: Pick<PlanChapter, 'startMs' | 'endMs' | 'photoCount'>,
  timeZone: string,
  language: EventLanguage,
): string => {
  const texts = BOOK_TEXTS[language]
  const from = localParts(chapter.startMs, timeZone)
  const to = localParts(chapter.endMs, timeZone)
  return `${texts.timeRange(
    formatClock(from.hour, from.minute, language),
    formatClock(to.hour, to.minute, language),
  )} · ${texts.photoCount(chapter.photoCount)}`
}
