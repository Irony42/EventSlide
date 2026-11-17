import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeUpdateEventSettings, type UpdateEventSettings } from './updateEventSettings'

/** The reveal hour is judged here, with the clock (spec 23 rules 3 and 4). */

const WEDDING = asEventId('evt-wedding')
const OWNER = asUserId('user-host')
const minutes = (n: number): Date => new Date(AT.getTime() + n * 60_000)

describe('updateEventSettings: the reveal group', () => {
  let events: FakeEventRepository
  let update: UpdateEventSettings

  const seed = (reveal: { enabled?: boolean; at?: Date | null; film?: boolean }) =>
    events.seed(anEvent({ id: WEDDING, ownerId: OWNER, settings: { reveal } }))

  beforeEach(async () => {
    const clients = new FakeClientRepository()
    events = new FakeEventRepository({ clients })
    const memberships = new FakeMembershipRepository()
    await memberships.grant({ eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT })
    update = makeUpdateEventSettings({
      clock: new FakeClock(),
      events,
      clients,
      memberships,
      bus: new RecordingEventBus(),
    })
  })

  it('writes a future hour and turns the mode on', async () => {
    seed({})

    const result = await update({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { reveal: { enabled: true, at: minutes(90) } },
    })

    expect(result.ok && result.value.settings.reveal).toEqual({
      enabled: true,
      at: minutes(90),
      film: false,
    })
  })

  it('refuses an hour that has already gone by, and stores nothing', async () => {
    seed({ enabled: true })

    const result = await update({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { reveal: { at: minutes(-1) } },
    })

    expect(!result.ok && result.error.code).toBe('eventSettings.revealInPast')
    expect((await events.findById(WEDDING))?.settings.reveal.at).toBeNull()
  })

  it('refuses to move a reveal that is done into the future', async () => {
    seed({ enabled: true, at: minutes(-30) })

    const result = await update({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { reveal: { at: minutes(60) } },
    })

    expect(!result.ok && result.error.code).toBe('eventSettings.revealDone')
    expect((await events.findById(WEDDING))?.settings.reveal.at).toEqual(minutes(-30))
  })

  it('lets the host switch the mode off after the reveal', async () => {
    seed({ enabled: true, at: minutes(-30) })

    const result = await update({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { reveal: { enabled: false } },
    })

    expect(result.ok && result.value.settings.reveal.enabled).toBe(false)
  })

  it('accepts a form sent back whole with the past hour it already holds', async () => {
    seed({ enabled: true, at: minutes(-30), film: false })

    const result = await update({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { moderation: 'auto', reveal: { enabled: true, at: minutes(-30), film: true } },
    })

    expect(result.ok && result.value.settings.reveal.film).toBe(true)
  })

  it('merges the film look into the stored group without forgetting the hour', async () => {
    seed({ enabled: true, at: minutes(45) })

    const result = await update({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { reveal: { film: true } },
    })

    expect(result.ok && result.value.settings.reveal).toEqual({
      enabled: true,
      at: minutes(45),
      film: true,
    })
  })
})
