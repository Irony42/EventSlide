import { describe, expect, it } from 'vitest'
import { asPhotoId, type PhotoId } from '../shared/ids'
import {
  advance,
  buildPlaylist,
  cursorForRevision,
  insertionPointFor,
  playlistRevision,
  slotsAt,
  type Playlist,
  type PlaylistCandidate,
  type PlaylistOptions,
  type PlaylistPosition,
} from './playlist'

const LIVE: PlaylistOptions = { windowSize: 10, freshFirst: true }

const candidate = (id: string, createdAt: string): PlaylistCandidate => ({
  id: asPhotoId(id),
  createdAt: new Date(createdAt),
})

const playlistFrom = (items: readonly PhotoId[]): Playlist => ({
  items,
  revision: playlistRevision(items),
})

const playlistOf = (...ids: string[]): Playlist => playlistFrom(ids.map((id) => asPhotoId(id)))

const built = (candidates: readonly PlaylistCandidate[]): Playlist => {
  const result = buildPlaylist(candidates, LIVE)
  if (!result.ok) throw result.error
  return result.value
}

/** Splices at the insertion point, refusing to guess when there is not one. */
const withFresh = (position: PlaylistPosition, freshId: PhotoId): Playlist => {
  const index = insertionPointFor(position, freshId)
  if (index === null) throw new Error(`${freshId} is already in rotation`)
  return playlistFrom(position.playlist.items.toSpliced(index, 0, freshId))
}

const EMPTY = playlistOf()

/** One evening, out of order on purpose: rows arrive from SQLite, not from a timeline. */
const EVENING: PlaylistCandidate[] = [
  candidate('toast', '2024-06-01T21:30:00.000Z'),
  candidate('arrival', '2024-06-01T19:00:00.000Z'),
  candidate('dance', '2024-06-01T23:15:00.000Z'),
]

const TIE_ORDERS: [string, string][] = [
  ['early-id', 'later-id'],
  ['later-id', 'early-id'],
]

describe('buildPlaylist', () => {
  it('shows the newest photo first, so a guest sees their upload within a slide or two', () => {
    const result = buildPlaylist(EVENING, { windowSize: 10, freshFirst: true })

    expect(result.ok && result.value.items).toEqual(['dance', 'toast', 'arrival'])
  })

  it('replays the evening oldest first when the wall is not in fresh-first mode', () => {
    const result = buildPlaylist(EVENING, { windowSize: 10, freshFirst: false })

    expect(result.ok && result.value.items).toEqual(['arrival', 'toast', 'dance'])
  })

  it('caps the rotation at the window size, so an eight-hour run cannot grow forever', () => {
    const result = buildPlaylist(EVENING, { windowSize: 2, freshFirst: true })

    expect(result.ok && result.value.items).toEqual(['dance', 'toast'])
  })

  it('keeps the newest photos when it caps a chronological wall, not the first hour', () => {
    const result = buildPlaylist(EVENING, { windowSize: 2, freshFirst: false })

    expect(result.ok && result.value.items).toEqual(['toast', 'dance'])
  })

  it.each(TIE_ORDERS)('breaks a timestamp tie by id, given %s before %s', (first, second) => {
    const sameTick = '2024-06-01T20:00:00.000Z'

    const result = buildPlaylist([candidate(first, sameTick), candidate(second, sameTick)], {
      windowSize: 10,
      freshFirst: true,
    })

    expect(result.ok && result.value.items).toEqual(['early-id', 'later-id'])
  })

  it('gives two projectors the same revision from the same photos in a different order', () => {
    expect(built(EVENING).revision).toBe(built([...EVENING].reverse()).revision)
  })

  it('builds an empty playlist from an event with no published photos', () => {
    const result = buildPlaylist([], { windowSize: 10, freshFirst: true })

    expect(result.ok && result.value.items).toEqual([])
  })

  it('refuses a fractional window size', () => {
    const result = buildPlaylist(EVENING, { windowSize: 2.5, freshFirst: true })

    expect(!result.ok && result.error.code).toBe('playlist.windowSizeNotInteger')
  })

  it('accepts the smallest window there is, one photo on a loop', () => {
    const result = buildPlaylist(EVENING, { windowSize: 1, freshFirst: true })

    expect(result.ok && result.value.items).toEqual(['dance'])
  })

  it('refuses a window that could not hold a single photo', () => {
    const result = buildPlaylist(EVENING, { windowSize: 0, freshFirst: true })

    expect(!result.ok && result.error.code).toBe('playlist.windowSizeTooSmall')
  })

  it('reports a bad window size as invalid input', () => {
    const result = buildPlaylist(EVENING, { windowSize: -1, freshFirst: true })

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('playlistRevision', () => {
  it('is unchanged when the same list is rebuilt', () => {
    expect(playlistOf('a', 'b', 'c').revision).toBe(playlistOf('a', 'b', 'c').revision)
  })

  it('changes when the same photos are reordered', () => {
    expect(playlistOf('a', 'b', 'c').revision).not.toBe(playlistOf('c', 'b', 'a').revision)
  })

  it('changes when a photo is published into the playlist', () => {
    expect(playlistOf('a', 'b').revision).not.toBe(playlistOf('a', 'b', 'c').revision)
  })

  it('changes when a photo is taken off the wall', () => {
    expect(playlistOf('a', 'b', 'c').revision).not.toBe(playlistOf('a', 'c').revision)
  })

  it('separates ids, so two different playlists cannot fingerprint the same', () => {
    expect(playlistOf('ab', 'c').revision).not.toBe(playlistOf('a', 'bc').revision)
  })

  it('gives an empty playlist a revision of its own', () => {
    expect(EMPTY.revision).not.toBe(playlistOf('a').revision)
  })

  it('still fingerprints an empty playlist, so a wall with no photos has a revision', () => {
    expect(playlistRevision([]).length).toBeGreaterThan(0)
  })
})

describe('slotsAt', () => {
  it('fills the slots from the cursor forward', () => {
    expect(slotsAt(playlistOf('a', 'b', 'c', 'd', 'e'), 0, 3)).toEqual(['a', 'b', 'c'])
  })

  it('fills the last slots exactly, without wrapping round to a repeat', () => {
    expect(slotsAt(playlistOf('a', 'b', 'c', 'd', 'e'), 2, 3)).toEqual(['c', 'd', 'e'])
  })

  it('wraps past the end, so the last slide is followed by the first', () => {
    expect(slotsAt(playlistOf('a', 'b', 'c', 'd', 'e'), 3, 3)).toEqual(['d', 'e', 'a'])
  })

  it('shows each photo at most once when the playlist is shorter than the layout', () => {
    expect(slotsAt(playlistOf('a', 'b'), 1, 6)).toEqual(['b', 'a'])
  })

  it('wraps a cursor that has run past the end of the playlist', () => {
    expect(slotsAt(playlistOf('a', 'b', 'c'), 7, 1)).toEqual(['b'])
  })

  it('wraps a cursor that has stepped back before the start', () => {
    expect(slotsAt(playlistOf('a', 'b', 'c'), -1, 1)).toEqual(['c'])
  })

  it('shows nothing for an empty playlist instead of throwing', () => {
    expect(slotsAt(EMPTY, 0, 6)).toEqual([])
  })

  it('shows nothing for a layout that asks for no slots', () => {
    expect(slotsAt(playlistOf('a', 'b'), 0, 0)).toEqual([])
  })
})

describe('advance', () => {
  it('moves to the next slide', () => {
    expect(advance(playlistOf('a', 'b', 'c'), 0, 1)).toBe(1)
  })

  it('returns to the first slide after the last', () => {
    expect(advance(playlistOf('a', 'b', 'c'), 2, 1)).toBe(0)
  })

  it('steps backwards for a host who wants the previous photo', () => {
    expect(advance(playlistOf('a', 'b', 'c'), 0, -1)).toBe(2)
  })

  it('never returns a negative cursor', () => {
    expect(advance(playlistOf('a', 'b', 'c'), 0, -7)).toBe(2)
  })

  it('stays parked at the start while there is nothing to show', () => {
    expect(advance(EMPTY, 4, 1)).toBe(0)
  })
})

describe('cursorForRevision', () => {
  it('keeps showing the same photo when an upload is inserted ahead of it', () => {
    const previous = playlistOf('c', 'b', 'a')

    const cursor = cursorForRevision(playlistOf('d', 'c', 'b', 'a'), {
      playlist: previous,
      cursor: 1,
    })

    expect(cursor).toBe(2)
  })

  it('lands on a valid slide when the photo on screen was rejected', () => {
    const previous = playlistOf('a', 'b', 'c')

    const cursor = cursorForRevision(playlistOf('a', 'c'), { playlist: previous, cursor: 1 })

    expect(cursor).toBe(1)
  })

  it('clamps to the last slide when the playlist shrank past the cursor', () => {
    const previous = playlistOf('a', 'b', 'c', 'd')

    const cursor = cursorForRevision(playlistOf('x', 'y'), { playlist: previous, cursor: 3 })

    expect(cursor).toBe(1)
  })

  it('starts at the first slide when the wall had nothing on screen yet', () => {
    const cursor = cursorForRevision(playlistOf('a', 'b', 'c'), { playlist: EMPTY, cursor: 0 })

    expect(cursor).toBe(0)
  })

  it('parks at the start when every photo has been taken off the wall', () => {
    const cursor = cursorForRevision(EMPTY, { playlist: playlistOf('a', 'b'), cursor: 1 })

    expect(cursor).toBe(0)
  })
})

describe('insertionPointFor', () => {
  it('queues a fresh photo immediately after the slide on screen', () => {
    const playlist = playlistOf('a', 'b', 'c')

    expect(insertionPointFor({ playlist, cursor: 0 }, asPhotoId('fresh'))).toBe(1)
  })

  it('appends when the wall is on the last slide', () => {
    const playlist = playlistOf('a', 'b', 'c')

    expect(insertionPointFor({ playlist, cursor: 2 }, asPhotoId('fresh'))).toBe(3)
  })

  it('offers no insertion point for a photo already in rotation, so it cannot be queued twice', () => {
    const playlist = playlistOf('a', 'b', 'c')

    expect(insertionPointFor({ playlist, cursor: 2 }, asPhotoId('a'))).toBeNull()
  })

  it('puts the first photo of the evening at the start of an empty playlist', () => {
    expect(insertionPointFor({ playlist: EMPTY, cursor: 0 }, asPhotoId('fresh'))).toBe(0)
  })

  it('wraps a cursor that has run past the end of the playlist', () => {
    const playlist = playlistOf('a', 'b', 'c')

    expect(insertionPointFor({ playlist, cursor: 6 }, asPhotoId('fresh'))).toBe(1)
  })

  it('makes the fresh photo the very next slide once it is spliced in', () => {
    const playlist = playlistOf('a', 'b', 'c')
    const fresh = asPhotoId('fresh')

    const updated = withFresh({ playlist, cursor: 0 }, fresh)

    expect(slotsAt(updated, advance(updated, 0, 1), 1)).toEqual([fresh])
  })

  it('is still the very next slide when the wall is on the last one and the id appends', () => {
    const playlist = playlistOf('a', 'b', 'c')
    const fresh = asPhotoId('fresh')

    const updated = withFresh({ playlist, cursor: 2 }, fresh)

    expect(slotsAt(updated, advance(updated, 2, 1), 1)).toEqual([fresh])
  })
})
