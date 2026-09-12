import { describe, expect, it } from 'vitest'
import {
  allowedTransitionsFrom,
  canTransition,
  isInAlbum,
  isPhotoStatus,
  isVisibleOnWall,
  needsDecision,
  PHOTO_STATUSES,
  type PhotoStatus,
} from './photoStatus'

/**
 * `ALLOWED`, `REFUSED` and the four identity pairs together cover all sixteen ordered
 * pairs of the four statuses, so the table below is the whole machine and not a
 * selection of the cases that happen to work.
 */
const ALLOWED: readonly [PhotoStatus, PhotoStatus][] = [
  ['pending', 'published'],
  ['pending', 'rejected'],
  ['published', 'hidden'],
  ['published', 'rejected'],
  ['rejected', 'published'],
  ['hidden', 'published'],
  ['hidden', 'rejected'],
]

/**
 * Two rules live in this list. A decision, once taken, is a fact, so nothing returns
 * to `pending`. And `hidden` keeps a photo in the album, so it is reachable only from
 * the wall: hiding a pending or a rejected photo would quietly put it in the export.
 */
const REFUSED: readonly [PhotoStatus, PhotoStatus][] = [
  ['pending', 'hidden'],
  ['published', 'pending'],
  ['rejected', 'pending'],
  ['rejected', 'hidden'],
  ['hidden', 'pending'],
]

describe('canTransition', () => {
  it.each(ALLOWED)('lets a moderator take a %s photo to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it.each(REFUSED)('refuses to take a %s photo to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })

  it.each([...PHOTO_STATUSES])(
    'accepts %s to itself, so a double-clicked publish is idempotent',
    (status) => {
      expect(canTransition(status, status)).toBe(true)
    },
  )
})

describe('isPhotoStatus', () => {
  it.each([...PHOTO_STATUSES])('recognises %s as a status', (status) => {
    expect(isPhotoStatus(status)).toBe(true)
  })

  it('refuses a status outside the table', () => {
    // 1.0's column held 'accepted'; a stale client or a hand-edited row must not
    // become a status the machine has no transitions for.
    expect(isPhotoStatus('accepted')).toBe(false)
  })

  it('refuses a number', () => {
    expect(isPhotoStatus(1)).toBe(false)
  })

  it('refuses null', () => {
    expect(isPhotoStatus(null)).toBe(false)
  })

  it('refuses undefined', () => {
    expect(isPhotoStatus(undefined)).toBe(false)
  })
})

describe('allowedTransitionsFrom', () => {
  const MOVES: readonly [PhotoStatus, readonly PhotoStatus[]][] = [
    ['pending', ['published', 'rejected']],
    ['published', ['hidden', 'rejected']],
    ['rejected', ['published']],
    ['hidden', ['published', 'rejected']],
  ]

  it.each(MOVES)('offers a %s photo exactly the moves %j', (from, expected) => {
    expect(allowedTransitionsFrom(from)).toEqual(expected)
  })
})

const OFF_THE_WALL: readonly PhotoStatus[] = ['pending', 'rejected', 'hidden']
const ALREADY_DECIDED: readonly PhotoStatus[] = ['published', 'rejected', 'hidden']
const IN_THE_ALBUM: readonly PhotoStatus[] = ['published', 'hidden']

describe('isVisibleOnWall', () => {
  it('puts a published photo on the wall', () => {
    expect(isVisibleOnWall('published')).toBe(true)
  })

  it.each(OFF_THE_WALL)(
    'keeps a %s photo off the wall, so nothing is projected without a decision',
    (status) => {
      expect(isVisibleOnWall(status)).toBe(false)
    },
  )
})

describe('needsDecision', () => {
  it('counts a pending photo as awaiting the host', () => {
    expect(needsDecision('pending')).toBe(true)
  })

  it.each(ALREADY_DECIDED)(
    'does not ask the host to decide a %s photo again',
    (status) => {
      expect(needsDecision(status)).toBe(false)
    },
  )
})

describe('isInAlbum', () => {
  it.each(IN_THE_ALBUM)(
    'keeps a %s photo in the album, because off the wall is not the same as unwanted',
    (status) => {
      expect(isInAlbum(status)).toBe(true)
    },
  )

  it('excludes a rejected photo from the album, which 1.0 shipped in the ZIP anyway', () => {
    expect(isInAlbum('rejected')).toBe(false)
  })

  it('excludes a pending photo from the album until someone has decided', () => {
    expect(isInAlbum('pending')).toBe(false)
  })
})
