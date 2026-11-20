import { describe, expect, it } from 'vitest'
import { asChallengeId, asMissionId } from '../shared/ids'
import { byArrival, orientationOf, type BookPhoto } from './bookInput'
import {
  BURST_GAP_MS,
  byProminence,
  byQuality,
  findBursts,
  photoScore,
  selectPhotos,
} from './bookSelection'
import { MINUTE, guest, makePhoto } from './testing/bookFixtures'

const best60 = { kind: 'best', target: 60 } as const

/** `count` photographs a minute apart, from guest `who(i)`, with `over(i)` on top. */
const album = (
  count: number,
  over: (i: number) => Partial<BookPhoto> = () => ({}),
  startMinute = 0,
): BookPhoto[] =>
  Array.from({ length: count }, (_, i) => makePhoto({ minute: startMinute + i, ...over(i) }))

const ids = (photos: readonly BookPhoto[]): string[] => photos.map((p) => p.id)

describe('photoScore', () => {
  it('is 3 a heart, 2 for a caption, 2 for a mission or a challenge', () => {
    expect(photoScore(makePhoto())).toBe(0)
    expect(photoScore(makePhoto({ reactions: 4 }))).toBe(12)
    expect(photoScore(makePhoto({ hasCaption: true }))).toBe(2)
    expect(photoScore(makePhoto({ missionId: asMissionId('m') }))).toBe(2)
    expect(photoScore(makePhoto({ challengeId: asChallengeId('c') }))).toBe(2)
    expect(
      photoScore(makePhoto({ missionId: asMissionId('m'), challengeId: asChallengeId('c') })),
    ).toBe(2)
    expect(
      photoScore(makePhoto({ reactions: 1, hasCaption: true, missionId: asMissionId('m') })),
    ).toBe(7)
  })
})

describe('orders', () => {
  it('byQuality puts the best first, then the oldest, then the lowest id', () => {
    const low = makePhoto({ minute: 1 })
    const high = makePhoto({ minute: 5, reactions: 2 })
    const same = { ...low, id: 'z' as BookPhoto['id'] }
    expect([low, high].sort(byQuality)).toEqual([high, low])
    expect([same, low].sort(byQuality)[0]).toBe(low)
  })
  it('byProminence puts a starred photograph before a better scored one', () => {
    const star = makePhoto({ highlighted: true })
    const loved = makePhoto({ reactions: 9 })
    expect([loved, star].sort(byProminence)[0]).toBe(star)
    expect([star, makePhoto({ highlighted: true, reactions: 2 })].sort(byProminence)[0]).not.toBe(
      star,
    )
  })
  it('byArrival is a total order whatever the rows arrive in', () => {
    const a = makePhoto({ minute: 3 })
    const b = { ...a, id: 'zzz' as BookPhoto['id'] }
    expect(byArrival(a, b)).toBeLessThan(0)
    expect(byArrival(b, a)).toBeGreaterThan(0)
    expect(byArrival(a, a)).toBe(0)
    expect(orientationOf({ width: 5, height: 5 })).toBe('square')
  })
})

describe('findBursts', () => {
  const at = (ms: number, over: Partial<BookPhoto> = {}): BookPhoto =>
    makePhoto({ ...over, createdAt: new Date(1_000_000 + ms) })

  it('joins two photographs of one guest exactly 20 seconds apart', () => {
    const a = at(0)
    const b = at(BURST_GAP_MS)
    expect(findBursts([a, b])).toEqual([[a, b]])
  })
  it('does not join them one millisecond later', () => {
    expect(findBursts([at(0), at(BURST_GAP_MS + 1)])).toEqual([])
  })
  it('chains: each photograph is compared with the one before it in the burst', () => {
    const photos = [at(0), at(15_000), at(30_000), at(45_000)]
    expect(findBursts(photos)).toEqual([photos])
  })
  it('needs one orientation', () => {
    expect(findBursts([at(0), at(1000, { width: 1000, height: 1500 })])).toEqual([])
  })
  it('never joins a photograph without a guest, nor two guests', () => {
    expect(findBursts([at(0, { guestId: null }), at(1000, { guestId: null })])).toEqual([])
    expect(findBursts([at(0), at(1000, { guestId: guest(2) })])).toEqual([])
  })
  it('sees through the photographs of other guests in between', () => {
    const a = at(0)
    const other = at(5000, { guestId: guest(2) })
    const b = at(10_000)
    expect(findBursts([a, other, b])).toEqual([[a, b]])
  })
  it('starts a second burst after a pause', () => {
    const photos = [at(0), at(1000), at(100_000), at(101_000)]
    expect(findBursts(photos)).toEqual([photos.slice(0, 2), photos.slice(2)])
  })
})

describe('selectPhotos', () => {
  it('keeps every photograph in arrival order for "all", whatever order the rows come in', () => {
    const photos = album(20)
    const shuffled = [...photos].reverse()
    expect(ids(selectPhotos(shuffled, { kind: 'all' }))).toEqual(ids(photos))
  })

  it('takes everything when the target reaches the number of photographs, bursts included', () => {
    const photos = album(60, () => ({ guestId: guest(1) }))
    expect(selectPhotos(photos, best60)).toHaveLength(60)
  })

  it('always retains a starred photograph, even one nobody scored', () => {
    const photos = album(100, (i) => ({
      reactions: 5,
      guestId: guest(i % 5),
      highlighted: i === 7,
    }))
    photos[7] = { ...photos[7]!, reactions: 0 }
    const kept = selectPhotos(photos, best60)
    expect(kept).toHaveLength(60)
    expect(kept).toContain(photos[7])
  })

  it('stops at the starred photographs, the best of them, when they are more than the target', () => {
    const photos = album(100, (i) => ({
      highlighted: i < 70,
      reactions: i < 70 ? i : 50,
      guestId: guest(i),
    }))
    const kept = selectPhotos(photos, best60)
    expect(kept).toHaveLength(60)
    expect(kept.every((p) => p.highlighted)).toBe(true)
    expect(kept.map((p) => p.reactions)).not.toContain(0)
    expect(kept.map((p) => p.reactions)).toContain(69)
  })

  it('keeps at least one photograph of every photographer when places allow', () => {
    const photos = album(100, (i) => ({
      guestId: i < 71 ? guest(0) : guest(i - 70),
      reactions: i < 71 ? 9 : 0,
    }))
    const kept = selectPhotos(photos, best60)
    expect(kept).toHaveLength(60)
    const who = new Set(kept.map((p) => p.guestId))
    expect(who.size).toBe(30)
    expect(kept.filter((p) => p.guestId === guest(0))).toHaveLength(31)
  })

  it('keeps the photographers whose best photograph scores highest when places run short', () => {
    const photos = album(80, (i) => ({ guestId: guest(i), reactions: i }))
    const kept = selectPhotos(photos, best60)
    expect(kept).toHaveLength(60)
    expect(kept.map((p) => p.reactions).sort((a, b) => a - b)[0]).toBe(20)
  })

  it('does not count a photograph without a guest as a photographer', () => {
    const photos = album(80, (i) => ({ guestId: null, reactions: i }))
    const kept = selectPhotos(photos, best60)
    expect(kept.map((p) => p.reactions).sort((a, b) => a - b)[0]).toBe(20)
  })

  it('does not give a photographer already represented by a starred photograph a second place early', () => {
    const photos = album(100, (i) => ({
      guestId: guest(i < 70 ? 0 : i - 69),
      highlighted: i === 0,
      reactions: i < 70 ? 9 : 0,
    }))
    const kept = selectPhotos(photos, best60)
    // 1 starred (guest 0), then the 30 other photographers, then 29 more of guest 0.
    expect(new Set(kept.map((p) => p.guestId)).size).toBe(31)
    expect(kept.filter((p) => p.guestId === guest(0))).toHaveLength(30)
  })

  it('shares the other places among the chapters in proportion to their size', () => {
    const early = album(80, () => ({ guestId: guest(1) }), 0)
    const late = album(20, () => ({ guestId: guest(1) }), 80 + 180)
    const kept = selectPhotos([...early, ...late], best60)
    const inLate = kept.filter((p) => late.includes(p)).length
    expect(kept).toHaveLength(60)
    expect(inLate).toBe(12)
  })

  it('stops giving places to a chapter whose photographs are all taken', () => {
    const taken = album(40, (i) => ({ guestId: guest(i) }), 0)
    const rest = album(25, () => ({ guestId: guest(99) }), 40 + 180)
    const kept = selectPhotos([...taken, ...rest], best60)
    expect(kept).toHaveLength(60)
    expect(kept.filter((p) => taken.includes(p))).toHaveLength(40)
    expect(kept.filter((p) => rest.includes(p))).toHaveLength(20)
  })

  it('never lets a moment of the evening disappear', () => {
    const big = album(94, () => ({ guestId: guest(1), reactions: 5 }), 0)
    const small = album(6, () => ({ guestId: guest(1) }), 94 + 180)
    const kept = selectPhotos([...big, ...small], best60)
    expect(kept.filter((p) => small.includes(p)).length).toBeGreaterThanOrEqual(1)
  })

  it('does not reserve a place for a moment when none are left', () => {
    // 100 photographs of 100 photographers in chapters of 10 and starred ones taking all places.
    const photos = Array.from({ length: 10 }, (_, c) =>
      album(10, (i) => ({ guestId: guest(c * 10 + i), highlighted: c < 6 }), c * 200),
    ).flat()
    const kept = selectPhotos(photos, best60)
    expect(kept).toHaveLength(60)
    expect(kept.every((p) => p.highlighted)).toBe(true)
  })

  it('breaks ties by arrival, then id', () => {
    const photos = album(100, (i) => ({ guestId: guest(0), minute: 100 - i }))
    const kept = selectPhotos(photos, best60)
    // every score is 0: the 60 oldest are kept
    const oldest = [...photos].sort(byArrival).slice(0, 60)
    expect(ids(kept)).toEqual(ids(oldest))
  })

  it('keeps one photograph of a burst, the best, and the oldest on a tie', () => {
    const a = makePhoto({ minute: 0, guestId: guest(1) })
    const b = {
      ...makePhoto({ guestId: guest(1) }),
      createdAt: new Date(a.createdAt.getTime() + 5000),
      reactions: 3,
    }
    const c = {
      ...makePhoto({ guestId: guest(1) }),
      createdAt: new Date(a.createdAt.getTime() + 9000),
      reactions: 3,
    }
    const rest = album(70, (i) => ({ guestId: guest(2 + i), minute: 10 + i }))
    const kept = selectPhotos([a, b, c, ...rest], best60)
    const fromBurst = kept.filter((p) => [a, b, c].includes(p))
    expect(fromBurst).toEqual([b])
  })

  it('keeps every starred photograph of a burst', () => {
    const a = makePhoto({ minute: 0, guestId: guest(1), highlighted: true })
    const b = {
      ...makePhoto({ guestId: guest(1), highlighted: true }),
      createdAt: new Date(a.createdAt.getTime() + 5000),
    }
    const c = {
      ...makePhoto({ guestId: guest(1), reactions: 9 }),
      createdAt: new Date(a.createdAt.getTime() + 9000),
    }
    const rest = album(70, (i) => ({ guestId: guest(2 + i), minute: 10 + i }))
    const kept = selectPhotos([a, b, c, ...rest], best60)
    expect(kept).toContain(a)
    expect(kept).toContain(b)
    expect(kept).not.toContain(c)
  })

  it('takes every candidate when the bursts brought the album under the target', () => {
    const burst = Array.from({ length: 5 }, (_, i) => ({
      ...makePhoto({ guestId: guest(1) }),
      createdAt: new Date(Date.UTC(2026, 5, 13, 18, 0, i)),
    }))
    const rest = album(58, (i) => ({ guestId: guest(2 + i), minute: 10 + i }))
    const kept = selectPhotos([...burst, ...rest], best60)
    expect(kept).toHaveLength(59)
  })

  it('is the same whatever order the rows arrive in', () => {
    const photos = album(150, (i) => ({ guestId: guest(i % 9), reactions: (i * 7) % 5 }))
    const forward = selectPhotos(photos, best60)
    const backward = selectPhotos([...photos].reverse(), best60)
    expect(ids(backward)).toEqual(ids(forward))
    expect(MINUTE).toBe(60_000)
  })
})
