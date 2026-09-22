import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aMission, aPhoto, anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeListMissions, type ListMissions } from './listMissions'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('listMissions', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let missions: FakeMissionRepository
  let memberships: FakeMembershipRepository
  let listMissions: ListMissions

  const ask = (overrides: Partial<Parameters<ListMissions>[0]> = {}) =>
    listMissions({ eventId: WEDDING, actorId: OWNER, ...overrides })

  beforeEach(async () => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    missions = new FakeMissionRepository(photos)
    memberships = new FakeMembershipRepository()
    listMissions = makeListMissions({ events, missions, memberships })

    events.seed(
      anEvent({ id: WEDDING, ownerId: OWNER, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
      anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    )
    await memberships.grant({ eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT })
    await memberships.grant({
      eventId: WEDDING,
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })
    await memberships.grant({ eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT })
  })

  it('answers an empty list for an event whose host set no prompts', async () => {
    const result = await ask()

    expect(result.ok && result.value).toEqual([])
  })

  it('lists the prompts in the order the host wrote them', async () => {
    missions.seed(
      aMission({ id: 'm2', eventId: 'evt-wedding', createdAt: new Date(2_000) }),
      aMission({ id: 'm1', eventId: 'evt-wedding', createdAt: new Date(1_000) }),
    )

    const result = await ask()

    expect(result.ok && result.value.map((row) => row.mission.id)).toEqual(['m1', 'm2'])
  })

  it('says a prompt is answered once a published photograph names it', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))
    photos.seed(aPhoto({ id: 'p1', eventId: 'evt-wedding', status: 'published', missionId: 'm1' }))

    const result = await ask()

    expect(result.ok && result.value[0]?.achieved).toBe(true)
    expect(result.ok && result.value[0]?.progress.completedByGuests).toBe(1)
  })

  it('says a prompt is unanswered while its only photograph is still pending', async () => {
    // The host is looking at this screen to decide what the room has not done yet, and a
    // photograph nobody has approved is not something the room has done.
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))
    photos.seed(aPhoto({ id: 'p1', eventId: 'evt-wedding', status: 'pending', missionId: 'm1' }))

    const result = await ask()

    expect(result.ok && result.value[0]?.achieved).toBe(false)
  })

  it('shows a moderator the list, because knowing what is missing is not editing it', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))

    const result = await ask({ actorId: MODERATOR })

    expect(result.ok && result.value).toHaveLength(1)
  })

  it('answers a stranger as it answers an event that does not exist', async () => {
    const result = await ask({ actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('never shows another event"s prompts', async () => {
    missions.seed(aMission({ id: 'm-gala', eventId: 'evt-gala' }))

    const result = await ask()

    expect(result.ok && result.value).toEqual([])
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await ask({ eventId: asEventId('evt-ghost') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('still reads an archived event, which is then a record of what it asked for', async () => {
    events.seed(
      anEvent({
        id: WEDDING,
        ownerId: OWNER,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        status: 'archived',
      }),
    )
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))

    const result = await ask()

    expect(result.ok && result.value).toHaveLength(1)
  })
})
