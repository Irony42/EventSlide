import { asEventId, asUserId } from '../../domain/shared/ids'
import { makeCreateAnnouncement } from '../usecases/announcements/createAnnouncement'
import { makeDeleteAnnouncement } from '../usecases/announcements/deleteAnnouncement'
import { makeLaunchAnnouncement } from '../usecases/announcements/launchAnnouncement'
import { makeListAnnouncements } from '../usecases/announcements/listAnnouncements'
import { makeUpdateAnnouncement } from '../usecases/announcements/updateAnnouncement'
import { AT, anEvent } from './builders'
import { FakeAnnouncementRepository } from './fakeAnnouncementRepository'
import { FakeClock } from './fakeClock'
import { FakeEventRepository } from './fakeEventRepository'
import { FakeMembershipRepository } from './fakeMembershipRepository'
import { RecordingEventBus } from './recordingEventBus'
import { SequentialIdGenerator } from './sequentialIdGenerator'

/**
 * Two events and the five announcement use cases wired over fakes, for the tests that read like
 * a host's evening (spec 21): a live wedding with an owner and a moderator, a draft event, a
 * closed one and a stranger's gala.
 */

export const WEDDING = asEventId('evt-wedding')
export const DRAFT = asEventId('evt-draft')
export const CLOSED = asEventId('evt-closed')
export const GALA = asEventId('evt-gala')
export const OWNER = asUserId('user-host')
export const MODERATOR = asUserId('user-mod')
export const STRANGER = asUserId('user-stranger')

export interface AnnouncementScene {
  readonly events: FakeEventRepository
  readonly announcements: FakeAnnouncementRepository
  readonly memberships: FakeMembershipRepository
  readonly bus: RecordingEventBus
  readonly clock: FakeClock
  readonly create: ReturnType<typeof makeCreateAnnouncement>
  readonly update: ReturnType<typeof makeUpdateAnnouncement>
  readonly launch: ReturnType<typeof makeLaunchAnnouncement>
  readonly remove: ReturnType<typeof makeDeleteAnnouncement>
  readonly list: ReturnType<typeof makeListAnnouncements>
}

export const announcementScene = async (): Promise<AnnouncementScene> => {
  const events = new FakeEventRepository()
  const announcements = new FakeAnnouncementRepository()
  const memberships = new FakeMembershipRepository()
  const bus = new RecordingEventBus()
  const clock = new FakeClock(AT)
  const ids = new SequentialIdGenerator()

  events.seed(
    anEvent({ id: WEDDING, ownerId: OWNER, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
    anEvent({ id: DRAFT, ownerId: OWNER, slug: 'brouillon', joinCode: 'B4N9PT', status: 'draft' }),
    anEvent({ id: CLOSED, ownerId: OWNER, slug: 'termine', joinCode: 'C5M8QR', status: 'closed' }),
    anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
  )
  for (const eventId of [WEDDING, DRAFT, CLOSED]) {
    await memberships.grant({ eventId, userId: OWNER, role: 'owner', grantedAt: AT })
  }
  await memberships.grant({ eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT })
  await memberships.grant({ eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT })

  return {
    events,
    announcements,
    memberships,
    bus,
    clock,
    create: makeCreateAnnouncement({ events, announcements, memberships, ids, bus, clock }),
    update: makeUpdateAnnouncement({ events, announcements, memberships, bus, clock }),
    launch: makeLaunchAnnouncement({ events, announcements, memberships, bus, clock }),
    remove: makeDeleteAnnouncement({ events, announcements, memberships, bus }),
    list: makeListAnnouncements({ events, announcements, memberships, clock }),
  }
}
