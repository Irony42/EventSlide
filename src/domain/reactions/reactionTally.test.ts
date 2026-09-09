import { describe, expect, it } from 'vitest'
import { asGuestId, asPhotoId, type GuestId, type PhotoId } from '../shared/ids'
import type { ReactionKind } from './reactionKind'
import {
  emptyCounts,
  hasReacted,
  tally,
  topPhotos,
  totalReactions,
  type ReactionCounts,
  type TallyEntry,
} from './reactionTally'

const alice = asGuestId('guest-alice')
const bob = asGuestId('guest-bob')

const entry = (kind: ReactionKind, guestId: GuestId): TallyEntry => ({ kind, guestId })

const countsWith = (overrides: Partial<Record<ReactionKind, number>>): ReactionCounts => ({
  love: 0,
  laugh: 0,
  wow: 0,
  cheers: 0,
  clap: 0,
  ...overrides,
})

const mapOf = (
  photos: readonly (readonly [string, ReactionCounts])[],
): ReadonlyMap<PhotoId, ReactionCounts> =>
  new Map(photos.map(([id, counts]): [PhotoId, ReactionCounts] => [asPhotoId(id), counts]))

describe('emptyCounts', () => {
  it('reports every kind at zero, so the wall never reads a missing key', () => {
    expect(emptyCounts()).toEqual({ love: 0, laugh: 0, wow: 0, cheers: 0, clap: 0 })
  })

  it('hands out a fresh object each call', () => {
    expect(emptyCounts()).not.toBe(emptyCounts())
  })
})

describe('tally', () => {
  it('returns every kind at zero for a photo nobody has reacted to', () => {
    expect(tally([])).toEqual({ love: 0, laugh: 0, wow: 0, cheers: 0, clap: 0 })
  })

  it('counts each kind under its own key', () => {
    const counts = tally([entry('love', alice), entry('clap', bob), entry('love', bob)])

    expect(counts).toEqual(countsWith({ love: 2, clap: 1 }))
  })

  it('counts every row it is given rather than deduplicating', () => {
    const counts = tally([entry('wow', alice), entry('wow', alice)])

    expect(counts.wow).toBe(2)
  })

  it('leaves the next photo counting from zero', () => {
    tally([entry('love', alice), entry('clap', bob)])

    expect(emptyCounts()).toEqual(countsWith({}))
  })
})

describe('totalReactions', () => {
  it('is zero for a photo nobody has reacted to', () => {
    expect(totalReactions(emptyCounts())).toBe(0)
  })

  it('sums across every kind', () => {
    expect(totalReactions(countsWith({ love: 3, laugh: 1, clap: 2 }))).toBe(6)
  })

  it('counts a heart the same as a clap, so the ranking cannot be tilted by kind', () => {
    // `reactionWeight` doubles a heart for the animation. Three hearts must still be
    // three here, or the photo of the night is won by whichever button is prettiest.
    expect(totalReactions(countsWith({ love: 3 }))).toBe(3)
    expect(totalReactions(countsWith({ clap: 3 }))).toBe(3)
  })
})

describe('hasReacted', () => {
  const entries = [entry('love', alice), entry('clap', bob)]

  it('is true when that guest already sent that kind', () => {
    expect(hasReacted(entries, alice, 'love')).toBe(true)
  })

  it('is false for the same guest with a different kind', () => {
    expect(hasReacted(entries, alice, 'clap')).toBe(false)
  })

  it('is false for a different guest with the same kind', () => {
    expect(hasReacted(entries, bob, 'love')).toBe(false)
  })

  it('is false when nobody has reacted yet', () => {
    expect(hasReacted([], alice, 'love')).toBe(false)
  })
})

describe('topPhotos', () => {
  it('orders photos by total reactions, most first', () => {
    const byPhoto = mapOf([
      ['photo-quiet', countsWith({ love: 1 })],
      ['photo-loud', countsWith({ love: 4, clap: 2 })],
      ['photo-middle', countsWith({ wow: 3 })],
    ])

    const result = topPhotos(byPhoto, 3)

    expect(result.ok && result.value).toEqual([
      asPhotoId('photo-loud'),
      asPhotoId('photo-middle'),
      asPhotoId('photo-quiet'),
    ])
  })

  it.each([
    { order: 'ascending', ids: ['photo-a', 'photo-b', 'photo-c'] },
    { order: 'descending', ids: ['photo-c', 'photo-b', 'photo-a'] },
  ])('breaks a tie by photo id, whichever order the map was built in ($order)', ({ ids }) => {
    const byPhoto = mapOf(
      ids.map((id): readonly [string, ReactionCounts] => [id, countsWith({ love: 2 })]),
    )

    const result = topPhotos(byPhoto, 3)

    expect(result.ok && result.value).toEqual([
      asPhotoId('photo-a'),
      asPhotoId('photo-b'),
      asPhotoId('photo-c'),
    ])
  })

  it('truncates to the requested number of photos', () => {
    const byPhoto = mapOf([
      ['photo-a', countsWith({ love: 1 })],
      ['photo-b', countsWith({ love: 5 })],
      ['photo-c', countsWith({ love: 3 })],
    ])

    const result = topPhotos(byPhoto, 2)

    expect(result.ok && result.value).toEqual([asPhotoId('photo-b'), asPhotoId('photo-c')])
  })

  it('returns a single photo for the smallest limit it accepts', () => {
    const byPhoto = mapOf([
      ['photo-a', countsWith({ love: 1 })],
      ['photo-b', countsWith({ love: 5 })],
    ])

    const result = topPhotos(byPhoto, 1)

    expect(result.ok && result.value).toEqual([asPhotoId('photo-b')])
  })

  it('returns every photo when the limit exceeds how many there are', () => {
    const byPhoto = mapOf([['photo-a', countsWith({ love: 1 })]])

    const result = topPhotos(byPhoto, 10)

    expect(result.ok && result.value).toEqual([asPhotoId('photo-a')])
  })

  it('returns an empty ranking for an event nobody has reacted in', () => {
    const result = topPhotos(mapOf([]), 3)

    expect(result.ok && result.value).toEqual([])
  })

  it('refuses a limit of zero', () => {
    const result = topPhotos(mapOf([]), 0)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('reaction.limitOutOfRange')
  })

  it('refuses a negative limit', () => {
    const result = topPhotos(mapOf([]), -1)

    expect(!result.ok && result.error.code).toBe('reaction.limitOutOfRange')
  })

  it('refuses a fractional limit', () => {
    const result = topPhotos(mapOf([]), 2.5)

    expect(!result.ok && result.error.code).toBe('reaction.limitNotInteger')
  })

  it('reports a bad limit as invalid input rather than a conflict', () => {
    const result = topPhotos(mapOf([]), Number.NaN)

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})
