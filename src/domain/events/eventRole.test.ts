import { describe, expect, it } from 'vitest'
import {
  EVENT_ROLES,
  canDeleteEvent,
  canInviteModerators,
  canManageEvent,
  canModerate,
  isAtLeast,
  isEventRole,
  rank,
  type EventRole,
} from './eventRole'

const ALL_ROLES: EventRole[] = [...EVENT_ROLES]

describe('isEventRole', () => {
  it.each(ALL_ROLES)('recognises %s', (role) => {
    expect(isEventRole(role)).toBe(true)
  })

  it.each([['host'], ['admin'], ['OWNER'], [''], [1], [null], [undefined], [{ role: 'owner' }]])(
    'refuses %p, which a membership row or a form could still contain',
    (value: unknown) => {
      expect(isEventRole(value)).toBe(false)
    },
  )
})

describe('rank', () => {
  it('ranks the owner above a moderator', () => {
    expect(rank('owner')).toBeGreaterThan(rank('moderator'))
  })

  it('lets authorization ask for at least a moderator', () => {
    expect(isAtLeast('owner', 'moderator')).toBe(true)
  })

  it('refuses a moderator where an owner is required', () => {
    expect(isAtLeast('moderator', 'owner')).toBe(false)
  })

  it('accepts a role as at least itself', () => {
    expect(isAtLeast('moderator', 'moderator')).toBe(true)
  })
})

describe('capabilities by role', () => {
  it.each<[EventRole, boolean]>([
    ['owner', true],
    ['moderator', true],
  ])('both roles moderate photos, which is why a moderator exists (%s: %s)', (role, expected) => {
    expect(canModerate(role)).toBe(expected)
  })

  it.each<[EventRole, boolean]>([
    ['owner', true],
    ['moderator', false],
  ])('only the owner changes settings and the lifecycle (%s: %s)', (role, expected) => {
    expect(canManageEvent(role)).toBe(expected)
  })

  it.each<[EventRole, boolean]>([
    ['owner', true],
    ['moderator', false],
  ])('only the owner invites another moderator (%s: %s)', (role, expected) => {
    expect(canInviteModerators(role)).toBe(expected)
  })

  it.each<[EventRole, boolean]>([
    ['owner', true],
    ['moderator', false],
  ])('only the owner deletes the event and its album (%s: %s)', (role, expected) => {
    expect(canDeleteEvent(role)).toBe(expected)
  })
})
