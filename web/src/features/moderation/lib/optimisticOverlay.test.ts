import { describe, expect, it } from 'vitest'
import type { ModerationDecision, PhotoStatus } from '../../../lib/api/dto'
import {
  expiredIds,
  forgetInFlight,
  overlayInFlight,
  type DecidableRow,
  type InFlight,
} from './optimisticOverlay'

const row = (
  id: string,
  status: PhotoStatus,
  allowedDecisions: readonly ModerationDecision[] = ['hide'],
): DecidableRow => ({ id, status, allowedDecisions })

const held = (status: PhotoStatus, settledAfterRead: number | null): InFlight => ({
  status,
  settledAfterRead,
})

describe('overlayInFlight', () => {
  it('writes a decision still out over a read, without decisions on the row', () => {
    const result = overlayInFlight(
      [row('a', 'pending', ['publish', 'reject'])],
      new Map([['a', held('published', null)]]),
      3,
    )
    expect(result.rows).toEqual([{ id: 'a', status: 'published', allowedDecisions: [] }])
    expect(result.pendingDelta).toBe(-1)
    expect(result.expired).toEqual([])
  })

  it('writes a decision answered after the read started over it (a stale answer)', () => {
    const result = overlayInFlight([row('a', 'pending')], new Map([['a', held('rejected', 3)]]), 3)
    expect(result.rows[0]?.status).toBe('rejected')
    expect(result.expired).toEqual([])
  })

  it('leaves the server row alone from a read that started after the answer, and forgets it', () => {
    const result = overlayInFlight(
      [row('a', 'rejected', ['publish'])],
      new Map([['a', held('rejected', 3)]]),
      4,
    )
    expect(result.rows).toEqual([row('a', 'rejected', ['publish'])])
    expect(result.pendingDelta).toBe(0)
    expect(result.expired).toEqual(['a'])
  })

  it('forgets an expired decision whose row is not in the answer', () => {
    const result = overlayInFlight([row('b', 'pending')], new Map([['a', held('hidden', 1)]]), 2)
    expect(result.expired).toEqual(['a'])
    expect(result.rows).toEqual([row('b', 'pending')])
  })

  it('counts a photo put back to pending as one more pending', () => {
    const result = overlayInFlight(
      [row('a', 'published')],
      new Map([['a', held('pending', null)]]),
      1,
    )
    expect(result.pendingDelta).toBe(1)
  })

  it('does not move the badge for a decision between two decided statuses', () => {
    const result = overlayInFlight(
      [row('a', 'published')],
      new Map([['a', held('hidden', null)]]),
      1,
    )
    expect(result.pendingDelta).toBe(0)
  })

  it('does not mutate what it is given', () => {
    const inFlight = new Map([['a', held('rejected', 1)]])
    overlayInFlight([row('a', 'pending')], inFlight, 5)
    expect(inFlight.size).toBe(1)
  })

  it('leaves rows with nothing in flight untouched, in order', () => {
    const rows = [row('a', 'pending'), row('b', 'published')]
    expect(overlayInFlight(rows, new Map(), 1).rows).toEqual(rows)
  })
})

describe('expiredIds', () => {
  it('lists the entries answered before the read started, never one still out', () => {
    const entries = new Map([
      ['out', { settledAfterRead: null }],
      ['early', { settledAfterRead: 2 }],
      ['same', { settledAfterRead: 5 }],
      ['late', { settledAfterRead: 6 }],
    ])
    expect(expiredIds(entries, 5)).toEqual(['early'])
  })
})

describe('forgetInFlight', () => {
  it('forgets the decision it is given', () => {
    const decision = held('hidden', null)
    const map = new Map([['a', decision]])
    forgetInFlight(map, 'a', decision)
    expect(map.size).toBe(0)
  })

  it('keeps a later decision on the same photo', () => {
    const first = held('hidden', null)
    const later = held('published', null)
    const map = new Map([['a', later]])
    forgetInFlight(map, 'a', first)
    expect(map.get('a')).toBe(later)
  })
})
