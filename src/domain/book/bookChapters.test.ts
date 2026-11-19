import { describe, expect, it } from 'vitest'
import {
  CHAPTER_GAP_MS,
  chapterSubtitleText,
  chapterTitleText,
  chapterTitles,
  splitIntoRanges,
} from './bookChapters'
import { MINUTE, T0 } from './testing/bookFixtures'

/** Groups of the given sizes, a minute apart inside a group and `gaps[i]` minutes between groups. */
const timesOf = (sizes: number[], gaps: number[] = sizes.map(() => 60)): number[] => {
  const times: number[] = []
  let clock = 0
  sizes.forEach((size, group) => {
    if (group > 0) clock += gaps[group - 1]! * MINUTE
    for (let i = 0; i < size; i += 1) {
      times.push(clock)
      clock += MINUTE
    }
    clock -= MINUTE
  })
  return times
}

const sizesOf = (times: number[]): number[] =>
  splitIntoRanges(times).map((range) => range.end - range.start)

describe('splitIntoRanges', () => {
  it('has no chapter for no photograph', () => {
    expect(splitIntoRanges([])).toEqual([])
  })

  it('makes one chapter under 12 photographs, however long the silences', () => {
    expect(sizesOf(timesOf([6, 5], [600]))).toEqual([11])
  })

  it('cuts at a silence of exactly 45 minutes, not at 44', () => {
    expect(sizesOf(timesOf([8, 8], [45]))).toEqual([8, 8])
    expect(sizesOf(timesOf([8, 8], [44]))).toEqual([16])
    expect(CHAPTER_GAP_MS).toBe(45 * MINUTE)
  })

  it('merges a chapter of under 6 photographs with the previous one when it is closer', () => {
    expect(sizesOf(timesOf([10, 4, 10], [50, 90]))).toEqual([14, 10])
  })

  it('merges it with the next one when that is closer', () => {
    expect(sizesOf(timesOf([10, 4, 10], [90, 50]))).toEqual([10, 14])
  })

  it('merges it with the previous one on a tie', () => {
    expect(sizesOf(timesOf([10, 4, 10], [60, 60]))).toEqual([14, 10])
  })

  it('merges a short first chapter with the next, and a short last with the previous', () => {
    expect(sizesOf(timesOf([3, 12], [60]))).toEqual([15])
    expect(sizesOf(timesOf([12, 3], [60]))).toEqual([15])
  })

  it('keeps merging until every chapter has 6 photographs', () => {
    const sizes = sizesOf(timesOf([2, 2, 2, 2, 2, 2, 2]))
    expect(sizes.every((size) => size >= 6)).toBe(true)
    expect(sizes.reduce((a, b) => a + b)).toBe(14)
  })

  it('keeps at most 8 chapters, merging the two closest neighbours first', () => {
    const gaps = [60, 70, 80, 90, 100, 110, 120, 130, 140]
    const ranges = splitIntoRanges(timesOf(Array(10).fill(6) as number[], gaps))
    expect(ranges).toHaveLength(8)
    expect(ranges[0]).toEqual({ start: 0, end: 18 })
  })

  it('merges the closest pair even when it is in the middle', () => {
    const gaps = [140, 130, 120, 60, 110, 100, 90, 80, 70]
    const ranges = splitIntoRanges(timesOf(Array(10).fill(6) as number[], gaps))
    expect(ranges).toHaveLength(8)
    expect(ranges[3]).toEqual({ start: 18, end: 30 })
  })

  it('merges the closest pair at the very end too', () => {
    const gaps = [140, 130, 120, 110, 100, 90, 80, 70, 60]
    const ranges = splitIntoRanges(timesOf(Array(10).fill(6) as number[], gaps))
    expect(ranges.at(-1)).toEqual({ start: 42, end: 60 })
  })
})

describe('chapterTitles', () => {
  const at = (hour: number, day = 13): number => Date.UTC(2026, 5, day, hour - 2) // Paris, UTC+2

  it('names a one-day evening by its moments, with no weekday', () => {
    const times = [at(10), at(15), at(20), at(23, 13)]
    const ranges = times.map((_, i) => ({ start: i, end: i + 1 }))
    expect(chapterTitles(times, ranges, 'Europe/Paris')).toEqual([
      { weekday: null, moment: 'morning', continued: false },
      { weekday: null, moment: 'afternoon', continued: false },
      { weekday: null, moment: 'evening', continued: false },
      { weekday: null, moment: 'night', continued: false },
    ])
  })

  it('takes the weekday when the photographs span several party days', () => {
    const times = [at(20, 13), at(25, 13), at(20, 14)] // Sat 20:00, Sun 01:00 (still Saturday), Sun 20:00
    const ranges = times.map((_, i) => ({ start: i, end: i + 1 }))
    const titles = chapterTitles(times, ranges, 'Europe/Paris')
    expect(titles.map((t) => [t.weekday, t.moment])).toEqual([
      [6, 'evening'],
      [6, 'night'],
      [0, 'evening'],
    ])
  })

  it('calls the second consecutive chapter of the same name a continuation', () => {
    const times = [at(19), at(21), at(22)]
    const ranges = times.map((_, i) => ({ start: i, end: i + 1 }))
    expect(chapterTitles(times, ranges, 'Europe/Paris').map((t) => t.continued)).toEqual([
      false,
      true,
      true,
    ])
  })

  it('does not call a same moment on another day a continuation', () => {
    const times = [at(20, 13), at(20, 14)]
    const ranges = times.map((_, i) => ({ start: i, end: i + 1 }))
    expect(chapterTitles(times, ranges, 'Europe/Paris').map((t) => t.continued)).toEqual([
      false,
      false,
    ])
  })

  it('reads the hour in the zone of the host', () => {
    const times = [Date.UTC(2026, 5, 13, 18)]
    const ranges = [{ start: 0, end: 1 }]
    expect(chapterTitles(times, ranges, 'Europe/Paris')[0]!.moment).toBe('evening') // 20:00
    expect(chapterTitles(times, ranges, 'Asia/Tokyo')[0]!.moment).toBe('night') // 03:00
    expect(chapterTitles(times, ranges, 'UTC')[0]!.moment).toBe('evening') // 18:00
  })
})

describe('chapter texts', () => {
  it('writes the title in the language of the book', () => {
    const evening = { weekday: null, moment: 'evening', continued: false } as const
    expect(chapterTitleText(evening, 'fr')).toBe('La soirée')
    expect(chapterTitleText({ ...evening, continued: true }, 'fr')).toBe('La soirée, suite')
    expect(chapterTitleText({ ...evening, weekday: 6 }, 'fr')).toBe('Samedi, la soirée')
    expect(chapterTitleText({ ...evening, weekday: 6 }, 'en')).toBe('Saturday evening')
    for (const language of ['de', 'es', 'it', 'en'] as const) {
      expect(chapterTitleText(evening, language).length).toBeGreaterThan(2)
    }
  })

  it('writes the subtitle with the hours of the zone and the number of photographs', () => {
    const chapter = { startMs: T0 + 90 * MINUTE, endMs: T0 + 245 * MINUTE, photoCount: 84 }
    expect(chapterSubtitleText(chapter, 'Europe/Paris', 'fr')).toBe(
      'de 21 h 30 à 0 h 05 · 84 photos',
    )
    expect(chapterSubtitleText({ ...chapter, photoCount: 1 }, 'UTC', 'en')).toBe(
      'from 7:30 PM to 10:05 PM · 1 photo',
    )
  })
})
