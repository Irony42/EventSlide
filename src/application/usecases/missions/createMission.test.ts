import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_MISSIONS_PER_EVENT } from '../../../domain/missions/mission'
import { MissionPrompt } from '../../../domain/missions/missionPrompt'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aMission, anEvent } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeCreateMission, type CreateMission } from './createMission'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('createMission', () => {
  let events: FakeEventRepository
  let missions: FakeMissionRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let createMission: CreateMission

  const ask = (overrides: Partial<Parameters<CreateMission>[0]> = {}) =>
    createMission({
      eventId: WEDDING,
      actorId: OWNER,
      prompt: 'un selfie avec les mariés',
      scope: 'guest',
      ...overrides,
    })

  beforeEach(async () => {
    events = new FakeEventRepository()
    missions = new FakeMissionRepository(new FakePhotoRepository())
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    createMission = makeCreateMission({
      events,
      missions,
      memberships,
      ids: new SequentialIdGenerator(),
      bus,
      clock: new FakeClock(AT),
    })

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

  it('adds the prompt the host typed, filed under their event', async () => {
    const result = await ask()

    expect(result.ok && result.value.prompt.value).toBe('un selfie avec les mariés')
    expect(result.ok && result.value.eventId).toBe(WEDDING)
    expect(result.ok && result.value.scope).toBe('guest')
  })

  it('persists it, so the wall sees it on its next read', async () => {
    const result = await ask()

    const listed = await missions.listWithProgress(WEDDING)
    expect(listed.map((row) => row.mission.id)).toEqual([result.ok ? result.value.id : 'none'])
  })

  it('announces the change, because a projector is showing that list', async () => {
    await ask()

    expect(bus.published).toEqual([{ type: 'mission.changed', eventId: WEDDING }])
  })

  it('takes the instant and the id from the ports, never from the ambient clock', async () => {
    const result = await ask()

    expect(result.ok && result.value.createdAt).toEqual(AT)
    expect(result.ok && result.value.id).toBe('mission-1')
  })

  it('keeps a once-for-the-evening prompt as one', async () => {
    const result = await ask({ prompt: 'la première danse', scope: 'event' })

    expect(result.ok && result.value.scope).toBe('event')
  })

  // ------------------------------------------------------------ authorization --

  it('refuses a moderator, who was lent a laptop rather than handed the event', async () => {
    const result = await ask({ actorId: MODERATOR })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
    expect(await missions.count(WEDDING)).toBe(0)
  })

  it('answers a stranger exactly as it answers an event that does not exist', async () => {
    // A `403` here would confirm that somebody else's wedding is real.
    const result = await ask({ actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('cannot add a prompt to another event, whatever the caller owns', async () => {
    const result = await ask({ eventId: GALA, actorId: OWNER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(await missions.count(GALA)).toBe(0)
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await ask({ eventId: asEventId('evt-ghost') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses an archived event, which is a record rather than a live object', async () => {
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
    expect(bus.published).toEqual([])
  })

  // ------------------------------------------------------------------- rules --

  it('refuses a prompt the domain will not accept', async () => {
    const result = await ask({ prompt: '   ' })

    expect(!result.ok && result.error.code).toBe('mission.promptEmpty')
    expect(bus.published).toEqual([])
  })

  it('refuses a prompt longer than the projector can read', async () => {
    const result = await ask({ prompt: 'x'.repeat(MissionPrompt.maxLength + 1) })

    expect(!result.ok && result.error.code).toBe('mission.promptTooLong')
  })

  it('refuses a prompt the host already added, rather than printing it twice', async () => {
    await ask({ prompt: 'un selfie' })

    const again = await ask({ prompt: 'un selfie' })

    expect(!again.ok && again.error.code).toBe('mission.duplicate')
    expect(await missions.count(WEDDING)).toBe(1)
  })

  it('treats two spellings of one prompt as one prompt', async () => {
    // `MissionPrompt` folds whitespace, so the unique index sees one value — and a host
    // who pastes the same sentence twice must not be told it is different.
    await ask({ prompt: 'un selfie' })

    const again = await ask({ prompt: '  un   selfie  ' })

    expect(!again.ok && again.error.code).toBe('mission.duplicate')
  })

  it('lets another event ask for the same thing', async () => {
    await ask({ prompt: 'un selfie' })

    const gala = await ask({ eventId: GALA, actorId: STRANGER, prompt: 'un selfie' })

    expect(gala.ok).toBe(true)
  })

  it('refuses the thirteenth prompt, which is what keeps the panel readable', async () => {
    for (let index = 0; index < MAX_MISSIONS_PER_EVENT; index += 1) {
      await missions.save(
        aMission({ id: `m${index}`, eventId: 'evt-wedding', prompt: `p${index}` }),
      )
    }

    const result = await ask()

    expect(!result.ok && result.error.code).toBe('mission.limitReached')
    expect(!result.ok && result.error.details).toEqual({ max: MAX_MISSIONS_PER_EVENT })
    expect(bus.published).toEqual([])
  })

  it('still accepts the twelfth', async () => {
    for (let index = 0; index < MAX_MISSIONS_PER_EVENT - 1; index += 1) {
      await missions.save(
        aMission({ id: `m${index}`, eventId: 'evt-wedding', prompt: `p${index}` }),
      )
    }

    expect((await ask()).ok).toBe(true)
  })

  it('counts the ceiling per event, not across the box', async () => {
    for (let index = 0; index < MAX_MISSIONS_PER_EVENT; index += 1) {
      await missions.save(aMission({ id: `g${index}`, eventId: 'evt-gala', prompt: `p${index}` }))
    }

    expect((await ask()).ok).toBe(true)
  })
})
