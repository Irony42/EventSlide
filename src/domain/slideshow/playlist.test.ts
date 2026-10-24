import { describe, expect, it } from 'vitest'
import { asPhotoId, type PhotoId } from '../shared/ids'
import {
  buildPlaylist,
  playlistRevision,
  type Playlist,
  type PlaylistCandidate,
  type PlaylistOptions,
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

  // Fixed values: the server announces the revision and every projector compares it with the one
  // it holds, so a changed mixing, seed or separator makes every wall refetch at once, and nothing
  // else here would notice, since each other case compares two values from the same
  // implementation. A deliberate change updates these three literals and nothing else.
  it.each([
    { ids: [] as readonly string[], revision: '1efc4f' },
    { ids: ['a', 'b'], revision: '1n7dmhi' },
    { ids: ['photo-1', 'photo-2', 'photo-3'], revision: '1uacp29' },
  ])('fingerprints $ids as $revision, on every box', ({ ids, revision }) => {
    expect(playlistRevision(ids.map(asPhotoId))).toBe(revision)
  })

  it('still fingerprints an empty playlist, so a wall with no photos has a revision', () => {
    expect(playlistRevision([]).length).toBeGreaterThan(0)
  })
})
