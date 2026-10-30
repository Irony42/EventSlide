import { describe, expect, it } from 'vitest'
import type { GuestId, PhotoId } from '../shared/ids'
import { firstStillsOfGuests, type FirstPhotoCandidate } from './firstPhotos'

const photo = (
  id: string,
  guest: string | null,
  minute: number,
  kind: 'photo' | 'clip' = 'photo',
): FirstPhotoCandidate => ({
  id: id as PhotoId,
  guestId: guest === null ? null : (guest as GuestId),
  createdAt: new Date(Date.UTC(2026, 9, 30, 21, minute)),
  kind,
})

const firstIds = (candidates: readonly FirstPhotoCandidate[]): readonly string[] =>
  [...firstStillsOfGuests(candidates)].sort()

describe('the first photo of a guest', () => {
  it('is the earliest upload of that guest, whatever order the list comes in', () => {
    const list = [photo('p3', 'julie', 30), photo('p1', 'julie', 10), photo('p2', 'julie', 20)]
    expect(firstIds(list)).toEqual(['p1'])
    expect(firstIds([...list].reverse())).toEqual(['p1'])
  })

  it('is one per guest', () => {
    const list = [
      photo('a2', 'tom', 15),
      photo('a1', 'tom', 5),
      photo('b1', 'lea', 8),
      photo('b2', 'lea', 9),
    ]
    expect(firstIds(list)).toEqual(['a1', 'b1'])
  })

  it('breaks a tie between files of one upload by id, so two projectors agree', () => {
    const list = [photo('p2', 'julie', 10), photo('p1', 'julie', 10)]
    expect(firstIds(list)).toEqual(['p1'])
    expect(firstIds([...list].reverse())).toEqual(['p1'])
  })

  it('does not say it of a clip, nor of a photo that follows a clip', () => {
    const list = [photo('v1', 'julie', 5, 'clip'), photo('p1', 'julie', 10)]
    expect(firstIds(list)).toEqual([])
  })

  it('says it of a photo that comes before a clip', () => {
    const list = [photo('p1', 'julie', 5), photo('v1', 'julie', 10, 'clip')]
    expect(firstIds(list)).toEqual(['p1'])
  })

  it('has nothing to say about a host’s own upload', () => {
    expect(firstIds([photo('h1', null, 5), photo('h2', null, 6)])).toEqual([])
  })

  it('has nothing to say about an empty list', () => {
    expect(firstIds([])).toEqual([])
  })
})
