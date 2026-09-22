import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asMissionId, asUserId } from '../../../domain/shared/ids'
import { AT, aMission, aPhoto, anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeUpdateMission, type UpdateMission } from './updateMission'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('updateMission', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let missions: FakeMissionRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let updateMission: UpdateMission

  const ask = (overrides: Partial<Parameters<UpdateMission>[0]> = {}) =>
    updateMission({
      eventId: WEDDING,
      missionId: asMissionId('m1'),
      actorId: OWNER,
      prompt: 'un selfie avec les mariés',
      scope: 'guest',
      ...overrides,
    })

  beforeEach(async () => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    missions = new FakeMissionRepository(photos)
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    updateMission = makeUpdateMission({ events, missions, memberships, bus })

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
      aMission({ id: 'm1', eventId: 'evt-wedding', prompt: 'un selfi avec les mariés' }),
      aMission({ id: 'm2', eventId: 'evt-wedding', prompt: 'la première danse' }),
      aMission({ id: 'm-gala', eventId: 'evt-gala', prompt: 'un selfie' }),
    )
  })

  it('corrects the prompt the host mistyped', async () => {
    const result = await ask()

    expect(result.ok && result.value.prompt.value).toBe('un selfie avec les mariés')
  })

  it('keeps the photographs already filed under it, which is why editing exists', async () => {
    // Delete-and-recreate would unfile them and silently undo four guests' work.
    photos.seed(aPhoto({ id: 'p1', eventId: 'evt-wedding', status: 'published', missionId: 'm1' }))

    await ask()

    const listed = await missions.listWithProgress(WEDDING)
    expect(listed.find((row) => row.mission.id === 'm1')?.progress.publishedPhotos).toBe(1)
  })

  it('changes who the prompt is asked of', async () => {
    const result = await ask({ scope: 'event' })

    expect(result.ok && result.value.scope).toBe('event')
  })

  it('accepts the prompt unchanged, so the scope alone can be edited', async () => {
    // The row holds this prompt itself; refusing it would make the scope uneditable.
    const result = await ask({ prompt: 'un selfi avec les mariés', scope: 'event' })

    expect(result.ok && result.value.scope).toBe('event')
  })

  it('announces the change', async () => {
    await ask()

    expect(bus.published).toEqual([{ type: 'mission.changed', eventId: WEDDING }])
  })

  it('refuses a prompt another mission of this event already holds', async () => {
    const result = await ask({ prompt: 'la première danse' })

    expect(!result.ok && result.error.code).toBe('mission.duplicate')
    expect(bus.published).toEqual([])
  })

  it('refuses a prompt the domain will not accept', async () => {
    const result = await ask({ prompt: '' })

    expect(!result.ok && result.error.code).toBe('mission.promptEmpty')
  })

  // ------------------------------------------------------------ authorization --

  it('refuses a moderator', async () => {
    const result = await ask({ actorId: MODERATOR })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
  })

  it('answers a stranger as it answers an event that does not exist', async () => {
    const result = await ask({ actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('cannot reach a mission that belongs to another event', async () => {
    const result = await ask({ missionId: asMissionId('m-gala') })

    expect(!result.ok && result.error.code).toBe('mission.notFound')
    const gala = await missions.findById(GALA, asMissionId('m-gala'))
    expect(gala?.prompt.value).toBe('un selfie')
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await ask({ eventId: asEventId('evt-ghost') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers notFound for a mission that does not exist', async () => {
    const result = await ask({ missionId: asMissionId('m-ghost') })

    expect(!result.ok && result.error.code).toBe('mission.notFound')
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
  })
})
