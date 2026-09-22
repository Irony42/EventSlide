import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asMissionId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import { AT, aMission, aPhoto, anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeDeleteMission, type DeleteMission } from './deleteMission'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('deleteMission', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let missions: FakeMissionRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let deleteMission: DeleteMission

  const ask = (overrides: Partial<Parameters<DeleteMission>[0]> = {}) =>
    deleteMission({ eventId: WEDDING, missionId: asMissionId('m1'), actorId: OWNER, ...overrides })

  beforeEach(async () => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    missions = new FakeMissionRepository(photos)
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    deleteMission = makeDeleteMission({ events, missions, memberships, bus })

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

    missions.seed(
      aMission({ id: 'm1', eventId: 'evt-wedding', prompt: 'un selfie' }),
      aMission({ id: 'm-gala', eventId: 'evt-gala', prompt: 'un selfie' }),
    )
  })

  it('removes the prompt', async () => {
    const result = await ask()

    expect(result.ok).toBe(true)
    expect(await missions.findById(WEDDING, asMissionId('m1'))).toBeNull()
  })

  it('keeps every photograph that was filed under it, unfiled', async () => {
    // §2.1's own rule about what happens to a mission's photographs afterwards: they are
    // ordinary photographs. `CASCADE` here would put a data-loss operation one keystroke
    // away from a typo fix.
    photos.seed(aPhoto({ id: 'p1', eventId: 'evt-wedding', status: 'published', missionId: 'm1' }))

    await ask()

    const photo = await photos.findById(WEDDING, asPhotoId('p1'))
    expect(photo).not.toBeNull()
    expect(photo?.missionId).toBeNull()
    expect(photo?.status).toBe('published')
  })

  it('announces the change', async () => {
    await ask()

    expect(bus.published).toEqual([{ type: 'mission.changed', eventId: WEDDING }])
  })

  // ------------------------------------------------------------ authorization --

  it('refuses a moderator', async () => {
    const result = await ask({ actorId: MODERATOR })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
    expect(await missions.findById(WEDDING, asMissionId('m1'))).not.toBeNull()
  })

  it('answers a stranger as it answers an event that does not exist', async () => {
    const result = await ask({ actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('cannot delete a mission that belongs to another event', async () => {
    // The port's delete is idempotent, so without the scoped lookup first this would
    // answer success and teach a caller that ids from elsewhere are accepted here.
    const result = await ask({ missionId: asMissionId('m-gala') })

    expect(!result.ok && result.error.code).toBe('mission.notFound')
    expect(await missions.findById(GALA, asMissionId('m-gala'))).not.toBeNull()
    expect(bus.published).toEqual([])
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await ask({ eventId: asEventId('evt-ghost') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers notFound for a mission that is already gone', async () => {
    await ask()

    const again = await ask()

    expect(!again.ok && again.error.code).toBe('mission.notFound')
  })

  it('refuses an archived event', async () => {
    events.seed(
      anEvent({
        id: WEDDING,
        ownerId: OWNER,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        status: 'archived',
      }),
    )

    const result = await ask()

    expect(!result.ok && result.error.code).toBe('event.immutable')
    expect(await missions.findById(WEDDING, asMissionId('m1'))).not.toBeNull()
  })
})
