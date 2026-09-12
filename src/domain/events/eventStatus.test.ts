import { describe, expect, it } from 'vitest'
import {
  EVENT_STATUSES,
  acceptsGuests,
  acceptsUploads,
  allowedTransitionsFrom,
  allowsModeration,
  canTransition,
  isEventStatus,
  isMutable,
  retentionApplies,
  servesWall,
  type EventStatus,
} from './eventStatus'

const ALLOWED: [EventStatus, EventStatus][] = [
  ['draft', 'live'],
  ['draft', 'archived'],
  ['live', 'closed'],
  ['live', 'archived'],
  ['closed', 'live'],
  ['closed', 'archived'],
]

const REFUSED: [EventStatus, EventStatus][] = [
  ['draft', 'closed'],
  ['live', 'draft'],
  ['closed', 'draft'],
  ['archived', 'draft'],
  ['archived', 'live'],
  ['archived', 'closed'],
]

const ALL_STATUSES: EventStatus[] = [...EVENT_STATUSES]

describe('event lifecycle transitions', () => {
  it.each(ALLOWED)('lets a host move an event from %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it.each(REFUSED)('refuses to move an event from %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })

  it.each(ALL_STATUSES)('treats %s to itself as an idempotent no-op', (status) => {
    expect(canTransition(status, status)).toBe(true)
  })

  it.each<[EventStatus, EventStatus[]]>([
    ['draft', ['live', 'archived']],
    ['live', ['closed', 'archived']],
    ['closed', ['live', 'archived']],
    ['archived', []],
  ])('offers exactly one set of next steps from %s', (from, expected) => {
    expect(allowedTransitionsFrom(from)).toEqual(expected)
  })
})

describe('isEventStatus', () => {
  it.each(ALL_STATUSES)('recognises %s', (status) => {
    expect(isEventStatus(status)).toBe(true)
  })

  it.each([['LIVE'], ['pending'], [''], [42], [null], [undefined], [{ status: 'live' }]])(
    'refuses %p, which a stored row or a query string could still contain',
    (value: unknown) => {
      expect(isEventStatus(value)).toBe(false)
    },
  )
})

describe('capabilities by status', () => {
  it.each<[EventStatus, boolean]>([
    ['draft', false],
    ['live', true],
    ['closed', false],
    ['archived', false],
  ])('only a live event accepts a guest upload (%s: %s)', (status, expected) => {
    expect(acceptsUploads(status)).toBe(expected)
  })

  it.each<[EventStatus, boolean]>([
    ['draft', false],
    ['live', true],
    ['closed', false],
    ['archived', false],
  ])('only a live event issues a guest a device token (%s: %s)', (status, expected) => {
    expect(acceptsGuests(status)).toBe(expected)
  })

  it.each<[EventStatus, boolean]>([
    ['draft', false],
    ['live', true],
    ['closed', true],
    ['archived', false],
  ])(
    'keeps the wall playing after the party but not once archived (%s: %s)',
    (status, expected) => {
      expect(servesWall(status)).toBe(expected)
    },
  )

  it.each<[EventStatus, boolean]>([
    ['draft', true],
    ['live', true],
    ['closed', true],
    ['archived', false],
  ])('allows moderation until the event is archived (%s: %s)', (status, expected) => {
    expect(allowsModeration(status)).toBe(expected)
  })

  it.each<[EventStatus, boolean]>([
    ['draft', true],
    ['live', true],
    ['closed', true],
    ['archived', false],
  ])('freezes name, settings and join code once archived (%s: %s)', (status, expected) => {
    expect(isMutable(status)).toBe(expected)
  })

  it.each<[EventStatus, boolean]>([
    ['draft', false],
    ['live', false],
    ['closed', true],
    ['archived', true],
  ])('starts the retention clock only once the event has ended (%s: %s)', (status, expected) => {
    expect(retentionApplies(status)).toBe(expected)
  })
})
