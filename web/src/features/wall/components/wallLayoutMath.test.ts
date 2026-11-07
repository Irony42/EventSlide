import { describe, expect, it } from 'vitest'
import type { WallItemDto } from '../../../lib/api/dto'
import { aWallItem } from '../../../testing/renderWithProviders'
import type { RecentSlide, Slideshow } from '../hooks/useSlideshow'
import {
  newestOf,
  nextPhotoUrl,
  playlistWindow,
  rotatingSlots,
  saysFirstPhoto,
  splitPanes,
  tiltFor,
} from './wallLayoutMath'

const photo = (id: string, createdAt = '2026-06-20T20:00:00.000Z'): WallItemDto =>
  aWallItem({ id, createdAt })

const [a, b, c, d, e, f] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => photo(id)) as [
  WallItemDto,
  WallItemDto,
  WallItemDto,
  WallItemDto,
  WallItemDto,
  WallItemDto,
]
const six = [a, b, c, d, e, f]

const slide = (item: WallItemDto | null, fresh = false): RecentSlide => ({ item, fresh })
const history = (generation: number, ...recent: RecentSlide[]) => ({ generation, recent })
const ids = (items: readonly WallItemDto[]): string[] => items.map((item) => item.id)

describe('rotatingSlots', () => {
  it('fills the wall from the first frame: slots before their first turn show their own position', () => {
    expect(ids(rotatingSlots([a, b, c, d], history(0, slide(a)), 3))).toEqual(['a', 'b', 'c'])
  })

  it('changes one slot per slide: the slot whose turn it is takes the newest, the others keep theirs', () => {
    const slots = rotatingSlots(six, history(4, slide(e), slide(d), slide(c)), 3)

    // generation 4 over a cycle of 3: slot 1 has just turned (recent[0]), slot 0 turned one
    // slide ago (recent[1]), slot 2 two slides ago (recent[2]).
    expect(ids(slots)).toEqual(['d', 'e', 'c'])
  })

  it('never shows one photo twice: a duplicate slot takes the first photo that is not up', () => {
    expect(ids(rotatingSlots([a, b, c], history(0, slide(b)), 3))).toEqual(['b', 'a', 'c'])
  })

  it('a slot whose photo was taken down takes the first photo that is not up', () => {
    expect(ids(rotatingSlots([a, b, c], history(0, slide(null)), 3))).toEqual(['a', 'b', 'c'])
  })

  it('is as short as the playlist when the playlist is shorter than the grid', () => {
    expect(ids(rotatingSlots([a, b], history(0, slide(a)), 6))).toEqual(['a', 'b'])
  })

  it('is empty for an empty playlist', () => {
    expect(rotatingSlots([], history(0), 6)).toEqual([])
  })
})

describe('playlistWindow', () => {
  const five = [a, b, c, d, e]

  it('is a consecutive run from the cursor', () => {
    expect(ids(playlistWindow(five, 1, 3))).toEqual(['b', 'c', 'd'])
  })

  it('wraps past the end', () => {
    expect(ids(playlistWindow(five, 3, 4))).toEqual(['d', 'e', 'a', 'b'])
  })

  it('wraps a negative cursor from the end', () => {
    expect(ids(playlistWindow(five, -1, 2))).toEqual(['e', 'a'])
  })

  it('is no longer than the playlist', () => {
    expect(ids(playlistWindow(five, 0, 9))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('is empty for an empty playlist', () => {
    expect(playlistWindow([], 0, 3)).toEqual([])
  })
})

describe('tiltFor', () => {
  it('is the same for the same id, so two projectors lean a print the same way', () => {
    expect(tiltFor('photo-1')).toBe(tiltFor('photo-1'))
  })

  it('is pinned for known ids (FNV-1a folded into 9 degrees)', () => {
    expect(['photo-1', 'photo-2', 'a', 'clip-1'].map(tiltFor)).toEqual([-1, 2, 3, 1])
  })

  it('stays within four degrees either way', () => {
    for (let n = 0; n < 200; n += 1) {
      const tilt = tiltFor(`photo-${n}`)
      expect(Math.abs(tilt)).toBeLessThanOrEqual(4)
    }
  })
})

describe('splitPanes', () => {
  it('is empty for an empty playlist', () => {
    expect(splitPanes([], history(0))).toEqual([])
  })

  it('shows the two most recent on a short playlist: no look back under four photos', () => {
    expect(ids(splitPanes([a, b, c], history(0, slide(a))))).toEqual(['a', 'b'])
  })

  it('has the left pane look back half a playlist, the right one stays with the wall', () => {
    expect(ids(splitPanes(six, history(0, slide(a))))).toEqual(['d', 'b'])
  })

  it('shows a photo that has just jumped the queue as it is, with no look back', () => {
    expect(ids(splitPanes(six, history(0, slide(a, true))))).toEqual(['a', 'b'])
  })

  it('never puts the same photo in both halves: the right pane, which stays with the wall, keeps it', () => {
    // generation 1: the right pane's turn took `d`, the left pane's look back from `a` lands on `d`.
    expect(ids(splitPanes(six, history(1, slide(d), slide(a))))).toEqual(['e', 'd'])
  })

  it('lets a photo that jumped the queue keep the pane over the right one', () => {
    expect(ids(splitPanes(six, history(1, slide(d), slide(d, true))))).toEqual(['d', 'e'])
  })
})

describe('newestOf', () => {
  it('is null with nothing on the line', () => {
    expect(newestOf([])).toBeNull()
  })

  it('is the upload that arrived last, whichever slot it hangs in', () => {
    const items = [
      photo('old', '2026-06-20T20:00:00.000Z'),
      photo('new', '2026-06-20T22:00:00.000Z'),
      photo('mid', '2026-06-20T21:00:00.000Z'),
    ]

    expect(newestOf(items)).toBe('new')
  })

  it('keeps the earlier print on a tie', () => {
    expect(newestOf([photo('first'), photo('second')])).toBe('first')
  })

  it('lets a timestamp that does not parse lose to one that does', () => {
    expect(newestOf([photo('broken', 'not a date'), photo('fine')])).toBe('fine')
    expect(newestOf([photo('fine'), photo('broken', 'not a date')])).toBe('fine')
  })
})

describe('saysFirstPhoto', () => {
  const first = aWallItem({ id: 'f', firstFromGuest: true })
  const view = (over: Partial<Pick<Slideshow, 'current' | 'fresh'>>) => ({
    current: first,
    fresh: true,
    ...over,
  })

  it('says it for the fresh lane’s current first photo', () => {
    expect(saysFirstPhoto(first, view({}))).toBe(true)
  })

  it('does not say it outside the fresh lane', () => {
    expect(saysFirstPhoto(first, view({ fresh: false }))).toBe(false)
  })

  it('does not say it under a print the slide clock did not just bring in', () => {
    expect(saysFirstPhoto(first, view({ current: aWallItem({ id: 'other' }) }))).toBe(false)
    expect(saysFirstPhoto(first, view({ current: null }))).toBe(false)
  })

  it('does not say it for a photo that is not a guest’s first', () => {
    const second = aWallItem({ id: 'f', firstFromGuest: false })

    expect(saysFirstPhoto(second, view({ current: second }))).toBe(false)
  })
})

describe('nextPhotoUrl', () => {
  it('is the next photograph’s display URL, or null when there is none', () => {
    expect(nextPhotoUrl({ next: a })).toBe(a.displayUrl)
    expect(nextPhotoUrl({ next: null })).toBeNull()
  })
})
