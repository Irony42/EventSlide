import { asEventId, asUserId } from '../../domain/shared/ids'
import { makeDisableGuestInvite } from '../usecases/guestInvites/disableGuestInvite'
import { makeEnableGuestInvite } from '../usecases/guestInvites/enableGuestInvite'
import { makeGetGuestInvite } from '../usecases/guestInvites/getGuestInvite'
import { makeRotateGuestInviteToken } from '../usecases/guestInvites/rotateGuestInviteToken'
import { makeSaveGuestInvite } from '../usecases/guestInvites/saveGuestInvite'
import { makeViewGuestInvite } from '../usecases/guestInvites/viewGuestInvite'
import { AT, aClient, anEvent } from './builders'
import { FakeAuditLog } from './fakeAuditLog'
import { FakeClientRepository } from './fakeClientRepository'
import { FakeClock } from './fakeClock'
import { FakeEventRepository } from './fakeEventRepository'
import { FakeGuestInviteRepository } from './fakeGuestInviteRepository'
import { FakeGuestRsvpRepository } from './fakeGuestRsvpRepository'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { SequentialIdGenerator } from './sequentialIdGenerator'

/**
 * Events and the guest invitation use cases wired over fakes, for the tests that read like a
 * host's weeks before the party (spec 29): a live wedding with an owner and a moderator, a draft,
 * a closed event, an archived one, an event of a frozen client, and a stranger's gala.
 */

export const WEDDING = asEventId('evt-wedding')
export const DRAFT = asEventId('evt-draft')
export const CLOSED = asEventId('evt-closed')
export const ARCHIVED = asEventId('evt-archived')
export const FROZEN = asEventId('evt-frozen')
export const GALA = asEventId('evt-gala')
export const OWNER = asUserId('user-host')
export const MODERATOR = asUserId('user-mod')
export const STRANGER = asUserId('user-stranger')

/** A start the invitation can be saved with, and the zone it is read in. */
export const PARTY = { startsAt: '2026-12-13T18:00:00Z', timeZone: 'Europe/Paris' } as const

export interface GuestInviteScene {
  readonly events: FakeEventRepository
  readonly invites: FakeGuestInviteRepository
  readonly memberships: FakeMembershipRepository
  readonly audit: FakeAuditLog
  readonly clock: FakeClock
  readonly get: ReturnType<typeof makeGetGuestInvite>
  readonly save: ReturnType<typeof makeSaveGuestInvite>
  readonly enable: ReturnType<typeof makeEnableGuestInvite>
  readonly disable: ReturnType<typeof makeDisableGuestInvite>
  readonly rotate: ReturnType<typeof makeRotateGuestInviteToken>
  readonly view: ReturnType<typeof makeViewGuestInvite>
}

export const guestInviteScene = async (): Promise<GuestInviteScene> => {
  const clients = new FakeClientRepository().seed(aClient({ id: 'client-frozen', suspendedAt: AT }))
  const events = new FakeEventRepository({ clients })
  const invites = new FakeGuestInviteRepository()
  const memberships = new FakeMembershipRepository()
  const audit = new FakeAuditLog().withAccounts(OWNER, MODERATOR, STRANGER)
  const clock = new FakeClock(AT)
  const ids = new SequentialIdGenerator()

  events.seed(
    anEvent({ id: WEDDING, ownerId: OWNER, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
    anEvent({ id: DRAFT, ownerId: OWNER, slug: 'brouillon', joinCode: 'B4N9PT', status: 'draft' }),
    anEvent({ id: CLOSED, ownerId: OWNER, slug: 'termine', joinCode: 'C5M8QR', status: 'closed' }),
    anEvent({
      id: ARCHIVED,
      ownerId: OWNER,
      slug: 'archive',
      joinCode: 'D6P7RS',
      status: 'archived',
    }),
    anEvent({
      id: FROZEN,
      ownerId: OWNER,
      slug: 'gele',
      joinCode: 'E7Q6ST',
      clientId: 'client-frozen',
    }),
    anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
  )
  for (const eventId of [WEDDING, DRAFT, CLOSED, ARCHIVED, FROZEN]) {
    await memberships.grant({ eventId, userId: OWNER, role: 'owner', grantedAt: AT })
  }
  await memberships.grant({ eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT })
  await memberships.grant({ eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT })

  return {
    events,
    invites,
    memberships,
    audit,
    clock,
    get: makeGetGuestInvite({ events, memberships, invites }),
    save: makeSaveGuestInvite({ events, memberships, invites, audit, ids, clock }),
    enable: makeEnableGuestInvite({ events, memberships, invites, audit, clock }),
    disable: makeDisableGuestInvite({ events, memberships, invites, audit, clock }),
    rotate: makeRotateGuestInviteToken({ events, memberships, invites, audit, ids, clock }),
    view: makeViewGuestInvite({ events, invites, rsvps: new FakeGuestRsvpRepository(), clock }),
  }
}
