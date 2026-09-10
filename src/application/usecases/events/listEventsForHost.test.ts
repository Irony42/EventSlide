import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aGuest, aPhoto, anEvent, atPlus } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeListEventsForHost, type ListEventsForHost } from './listEventsForHost'

const HOST = asUserId('user-host')
const OTHER_HOST = asUserId('user-other')
const MODERATOR = asUserId('user-mod')
const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

describe('listEventsForHost', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let photos: FakePhotoRepository
  let guests: FakeGuestRepository
  let listEventsForHost: ListEventsForHost

  beforeEach(() => {
    memberships = new FakeMembershipRepository()
    photos = new FakePhotoRepository()
    guests = new FakeGuestRepository()
    events = new FakeEventRepository({ memberships, photos, guests })
    listEventsForHost = makeListEventsForHost({ events })
  })

  it('lists the events the host owns', async () => {
    events.seed(
      anEvent({ id: WEDDING, ownerId: HOST, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
    )

    const result = await listEventsForHost({ userId: HOST })

    expect(result.ok && result.value.map((summary) => summary.id)).toEqual([WEDDING])
  })

  /**
   * The dashboard is the one screen a host reaches without naming an event, so it is
   * the one place a missing scope would show every wedding on the box at once.
   */
  it('never lists an event belonging to another host', async () => {
    events.seed(
      anEvent({ id: GALA, ownerId: OTHER_HOST, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    )

    const result = await listEventsForHost({ userId: HOST })

    expect(result.ok && result.value).toEqual([])
  })

  it('lists an event the caller only moderates, since that console is theirs too', async () => {
    events.seed(
      anEvent({ id: WEDDING, ownerId: HOST, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
    )
    await memberships.grant({
      eventId: WEDDING,
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })

    const result = await listEventsForHost({ userId: MODERATOR })

    expect(result.ok && result.value.map((summary) => summary.id)).toEqual([WEDDING])
  })

  it('lists the newest event first, because that is the one running tonight', async () => {
    events.seed(
      anEvent({
        id: WEDDING,
        ownerId: HOST,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        createdAt: AT,
      }),
      anEvent({
        id: GALA,
        ownerId: HOST,
        slug: 'gala-annuel',
        joinCode: 'Z3N9PT',
        createdAt: atPlus(60_000),
      }),
    )

    const result = await listEventsForHost({ userId: HOST })

    expect(result.ok && result.value.map((summary) => summary.id)).toEqual([GALA, WEDDING])
  })

  it('carries the counts the dashboard shows next to each event', async () => {
    events.seed(
      anEvent({ id: WEDDING, ownerId: HOST, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
    )
    photos.seed(
      aPhoto({ id: 'photo-pending', eventId: WEDDING, status: 'pending', byteSize: 1_000 }),
      aPhoto({ id: 'photo-live', eventId: WEDDING, status: 'published', byteSize: 4_000 }),
    )
    guests.seed(aGuest({ id: 'guest-lea', eventId: WEDDING }))

    const result = await listEventsForHost({ userId: HOST })

    expect(result.ok && result.value[0]).toMatchObject({
      photoCount: 2,
      pendingCount: 1,
      guestCount: 1,
      usedBytes: 5_000,
    })
  })

  it('reports an empty dashboard as a success, not as a missing resource', async () => {
    const result = await listEventsForHost({ userId: HOST })

    expect(result.ok && result.value).toEqual([])
  })
})
