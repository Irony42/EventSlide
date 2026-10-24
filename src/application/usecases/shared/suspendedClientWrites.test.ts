import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, asMissionId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import { AT, anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { makeRegisterModerator } from '../auth/registerModerator'
import { makeChangeEventStatus } from '../events/changeEventStatus'
import { makePurgeEvent } from '../events/purgeEvent'
import { makeRenameEvent } from '../events/renameEvent'
import { makeRevokeModerator } from '../events/revokeModerator'
import { makeRotateJoinCode } from '../events/rotateJoinCode'
import { makeScheduleEvent } from '../events/scheduleEvent'
import { makeUpdateEventSettings } from '../events/updateEventSettings'
import { makeCreateShareLink } from '../gallery/createShareLink'
import { makeRevokeShareLink } from '../gallery/revokeShareLink'
import { makeRevokeGuest } from '../guests/revokeGuest'
import { makeCreateMission } from '../missions/createMission'
import { makeDeleteMission } from '../missions/deleteMission'
import { makeUpdateMission } from '../missions/updateMission'
import { makeModeratePhoto } from '../moderation/moderatePhoto'
import { makeModeratePhotosBulk } from '../moderation/moderatePhotosBulk'
import { makeDeletePhoto } from '../photos/deletePhoto'
import { asGuestId } from '../../../domain/shared/ids'

/**
 * **A suspended client's members read and may not write** (roadmap §10.7; G2-14), asked of every
 * host-side write use case, one by one.
 *
 * The rule was a test on the HTTP verb in `requireRole` and no use case knew it, so it could not
 * be exercised below ring 4 and a write that was not a non-GET would have walked through it. Each
 * case here builds one use case over a **frozen** event with every dependency except the two the
 * rule needs (`events`, `memberships`) replaced by one that throws on any use: the refusal has to
 * come before the use case touches anything else, which is what the verb test guaranteed by
 * running before the handler. The order against the role is held as well: a stranger is told
 * what a stranger is told (`event.notFound`), and a moderator of an owner-only action is told
 * `auth.forbidden`, so only somebody in scope learns that the client is frozen.
 */

const EVENT = asEventId('event-1')
const OTHER = asEventId('event-2')
const OWNER = asUserId('user-owner')
const MODERATOR = asUserId('user-moderator')
const STRANGER = asUserId('user-stranger')

/** A dependency the use case must not reach before it has refused: any use of it throws. */
const gone = <T extends object>(): T =>
  new Proxy({} as T, {
    get: (_target, property) => {
      throw new Error(`a frozen event reached a dependency (${String(property)})`)
    },
  })

type Outcome = Promise<Result<unknown, DomainError>>

interface Case {
  readonly name: string
  /** Who may do it: the one who gets to learn the client is frozen. */
  readonly member: 'owner' | 'moderator'
  readonly ask: (
    deps: { readonly events: FakeEventRepository; readonly memberships: FakeMembershipRepository },
    actor: typeof OWNER,
  ) => Outcome
}

const host = (userId: typeof OWNER) => ({ kind: 'host', userId }) as const

const CASES: readonly Case[] = [
  {
    name: 'changeEventStatus',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeChangeEventStatus({
        events,
        memberships,
        clients: gone(),
        bus: gone(),
        clock: gone(),
      })({ eventId: EVENT, actorId, status: 'closed' }),
  },
  {
    name: 'renameEvent',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeRenameEvent({ events, memberships, bus: gone() })({
        eventId: EVENT,
        actorId,
        name: 'Autre nom',
      }),
  },
  {
    name: 'rotateJoinCode',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeRotateJoinCode({ events, memberships, ids: gone(), bus: gone(), joinCodeLength: 6 })({
        eventId: EVENT,
        actorId,
      }),
  },
  {
    name: 'scheduleEvent',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeScheduleEvent({ events, memberships, bus: gone(), clock: gone() })({
        eventId: EVENT,
        actorId,
        scheduledOpenAt: null,
        scheduledCloseAt: null,
      }),
  },
  {
    name: 'updateEventSettings',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeUpdateEventSettings({ events, memberships, clients: gone(), bus: gone() })({
        eventId: EVENT,
        actorId,
        patch: {},
      }),
  },
  {
    name: 'purgeEvent',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makePurgeEvent({ events, memberships, media: gone() })({ eventId: EVENT, actorId }),
  },
  {
    name: 'createShareLink',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeCreateShareLink({
        events,
        memberships,
        shareLinks: gone(),
        hasher: gone(),
        signer: gone(),
        ids: gone(),
        clock: gone(),
      })({ eventId: EVENT, actorId }),
  },
  {
    name: 'revokeShareLink',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeRevokeShareLink({ events, memberships, shareLinks: gone(), clock: gone() })({
        eventId: EVENT,
        actorId,
      }),
  },
  {
    name: 'createMission',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeCreateMission({
        events,
        memberships,
        missions: gone(),
        ids: gone(),
        bus: gone(),
        clock: gone(),
      })({ eventId: EVENT, actorId, prompt: 'Le gâteau', scope: 'event' }),
  },
  {
    name: 'updateMission',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeUpdateMission({ events, memberships, missions: gone(), bus: gone() })({
        eventId: EVENT,
        missionId: asMissionId('mission-1'),
        actorId,
        prompt: 'Le gâteau',
        scope: 'event',
      }),
  },
  {
    name: 'deleteMission',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeDeleteMission({ events, memberships, missions: gone(), bus: gone() })({
        eventId: EVENT,
        missionId: asMissionId('mission-1'),
        actorId,
      }),
  },
  {
    name: 'registerModerator',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeRegisterModerator({ events, memberships, users: gone(), issueInvitation: gone() })({
        eventId: EVENT,
        actorId,
        email: 'lea@example.test',
        locale: 'fr',
      }),
  },
  {
    name: 'revokeModerator',
    member: 'owner',
    ask: ({ events, memberships }, actorId) =>
      makeRevokeModerator({ events, memberships })({
        eventId: EVENT,
        actorId,
        userId: MODERATOR,
      }),
  },
  {
    name: 'moderatePhoto',
    member: 'moderator',
    ask: ({ events, memberships }, actorId) =>
      makeModeratePhoto({ events, memberships, photos: gone(), bus: gone(), clock: gone() })({
        eventId: EVENT,
        photoId: asPhotoId('photo-1'),
        decision: 'publish',
        actor: host(actorId),
      }),
  },
  {
    name: 'moderatePhotosBulk',
    member: 'moderator',
    ask: ({ events, memberships }, actorId) =>
      makeModeratePhotosBulk({
        events,
        memberships,
        photos: gone(),
        bus: gone(),
        clock: gone(),
      })({
        eventId: EVENT,
        photoIds: [asPhotoId('photo-1')],
        decision: 'publish',
        actor: host(actorId),
      }),
  },
  {
    name: 'revokeGuest',
    member: 'moderator',
    ask: ({ events, memberships }, actorId) =>
      makeRevokeGuest({ events, memberships, guests: gone(), clock: gone() })({
        eventId: EVENT,
        actorId,
        guestId: asGuestId('guest-1'),
      }),
  },
]

describe('a suspended client’s event refuses its members’ writes', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository

  beforeEach(() => {
    events = new FakeEventRepository().seed(
      Event.restore({
        ...anEvent({ id: EVENT, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }).toProps(),
        clientSuspendedAt: AT,
      }),
    )
    memberships = new FakeMembershipRepository().seed(
      { eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT },
      { eventId: OTHER, userId: STRANGER, role: 'owner', grantedAt: AT },
    )
  })

  const refusalOf = (outcome: Awaited<Outcome>): readonly unknown[] =>
    outcome.ok ? ['allowed'] : [outcome.error.kind, outcome.error.code]

  it.each(CASES)('$name: 403 client.suspended for the member who may do it', async (c) => {
    const actor = c.member === 'owner' ? OWNER : MODERATOR

    const outcome = await c.ask({ events, memberships }, actor)

    expect(refusalOf(outcome)).toEqual(['forbidden', 'client.suspended'])
  })

  it.each(CASES)(
    '$name: a stranger is told event.notFound, not that the client is frozen',
    async (c) => {
      const outcome = await c.ask({ events, memberships }, STRANGER)

      expect(refusalOf(outcome)).toEqual(['notFound', 'event.notFound'])
    },
  )

  it.each(CASES)(
    '$name: an event that does not exist is event.notFound, to a member of nothing',
    async (c) => {
      const nothing = new FakeEventRepository()

      const outcome = await c.ask({ events: nothing, memberships }, OWNER)

      expect(refusalOf(outcome)).toEqual(['notFound', 'event.notFound'])
    },
  )

  it.each(CASES.filter((c) => c.member === 'owner'))(
    '$name: a moderator is told auth.forbidden before anything about the client',
    async (c) => {
      const outcome = await c.ask({ events, memberships }, MODERATOR)

      expect(refusalOf(outcome)).toEqual(['forbidden', 'auth.forbidden'])
    },
  )

  it('deletePhoto: refuses the host of a frozen event before it reads a photograph', async () => {
    const outcome = await makeDeletePhoto({
      events,
      photos: gone(),
      clips: gone(),
      media: gone(),
      bus: gone(),
      clock: gone(),
    })({ eventId: EVENT, photoId: asPhotoId('photo-1'), actor: host(OWNER) })

    expect(refusalOf(outcome)).toEqual(['forbidden', 'client.suspended'])
  })
})
