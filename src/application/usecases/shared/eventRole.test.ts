import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { anEvent } from '../../testing/builders'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { requireEditable, requireEventRole, type RoleRequirement } from './eventRole'

/**
 * The preludes of twenty-one use cases, tested once. Each use case keeps one test of its own
 * for the requirement it asks, which is what proves it asks the right one; what each answer IS
 * is here.
 */

const EVENT = asEventId('event-1')
const OTHER_EVENT = asEventId('event-2')
const OWNER = asUserId('user-owner')
const MODERATOR = asUserId('user-moderator')
const STRANGER = asUserId('user-stranger')

const REQUIREMENTS: readonly RoleRequirement[] = [
  'moderate',
  'manage',
  'delete',
  'inviteModerators',
]

describe('requireEventRole', () => {
  let memberships: FakeMembershipRepository

  beforeEach(() => {
    memberships = new FakeMembershipRepository()
    memberships.seed(
      { eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: new Date(0) },
      { eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: new Date(0) },
      { eventId: OTHER_EVENT, userId: STRANGER, role: 'owner', grantedAt: new Date(0) },
    )
  })

  const ask = (actor: typeof OWNER, requirement: RoleRequirement) =>
    requireEventRole(memberships, EVENT, actor, requirement)

  it.each(REQUIREMENTS)(
    'answers an owner of another event as an event that does not exist (%s)',
    async (requirement) => {
      // The scoped read: owning the gala makes nobody a host of this wedding.
      const result = await ask(STRANGER, requirement)

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'notFound',
        'event.notFound',
      ])
    },
  )

  it('answers an account with no membership anywhere in the same words', async () => {
    const result = await ask(asUserId('user-nobody'), 'manage')

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it.each(REQUIREMENTS)(
    'lets the owner through and says which role they hold (%s)',
    async (requirement) => {
      const result = await ask(OWNER, requirement)

      expect(result.ok && result.value).toBe('owner')
    },
  )

  it('lets a moderator moderate', async () => {
    const result = await ask(MODERATOR, 'moderate')

    expect(result.ok && result.value).toBe('moderator')
  })

  it.each(['manage', 'delete', 'inviteModerators'] as const)(
    'tells a moderator that %s is the host’s, which they may know as a member',
    async (requirement) => {
      const result = await ask(MODERATOR, requirement)

      expect(!result.ok && [result.error.kind, result.error.code, result.error.details]).toEqual([
        'forbidden',
        'auth.forbidden',
        { required: 'owner' },
      ])
    },
  )
})

describe('requireEditable', () => {
  it.each(['draft', 'live', 'closed'] as const)('lets a %s event be edited', (status) => {
    const result = requireEditable(anEvent({ status }))

    expect(result.ok).toBe(true)
  })

  it('refuses an archived event, naming its status', () => {
    const result = requireEditable(anEvent({ status: 'archived' }))

    expect(!result.ok && [result.error.kind, result.error.code, result.error.details]).toEqual([
      'conflict',
      'event.immutable',
      { status: 'archived' },
    ])
  })
})
