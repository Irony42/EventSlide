import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeUpdateEventSettings, type UpdateEventSettings } from './updateEventSettings'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('updateEventSettings', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let updateEventSettings: UpdateEventSettings

  beforeEach(async () => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    updateEventSettings = makeUpdateEventSettings({ events, memberships, bus })

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

  it('applies the setting the host changed', async () => {
    const result = await updateEventSettings({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { moderation: 'auto' },
    })

    expect(result.ok && result.value.settings.moderation).toBe('auto')
  })

  /** Absent means "leave it alone": the settings form sends one field, not all seven. */
  it('leaves a setting the patch did not mention alone', async () => {
    const result = await updateEventSettings({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { moderation: 'auto' },
    })

    expect(result.ok && result.value.settings.allowCaptions).toBe(true)
  })

  it('persists the change, so the next upload is moderated by the new rule', async () => {
    await updateEventSettings({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { allowReactions: false },
    })

    const stored = await events.findById(WEDDING)

    expect(stored?.settings.allowReactions).toBe(false)
  })

  it('announces the change, so an open console and the wall refetch the event', async () => {
    await updateEventSettings({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { moderation: 'auto' },
    })

    expect(bus.published).toEqual([{ type: 'event.settingsChanged', eventId: WEDDING }])
  })

  // ------------------------------------------------------------------ refusals --

  it('refuses a value outside the range the domain allows', async () => {
    const result = await updateEventSettings({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { retentionDays: 0 },
    })

    expect(!result.ok && result.error.code).toBe('eventSettings.retentionDaysInvalid')
  })

  it('announces nothing when the patch is refused', async () => {
    await updateEventSettings({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { retentionDays: 0 },
    })

    expect(bus.published).toEqual([])
  })

  it('refuses an archived event, whose media may already have been tiered off', async () => {
    events.seed(anEvent({ id: WEDDING, ownerId: OWNER, status: 'archived' }))

    const result = await updateEventSettings({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { moderation: 'auto' },
    })

    expect(!result.ok && result.error.code).toBe('event.immutable')
  })

  it('announces nothing when the event is archived', async () => {
    events.seed(anEvent({ id: WEDDING, ownerId: OWNER, status: 'archived' }))

    await updateEventSettings({
      eventId: WEDDING,
      actorId: OWNER,
      patch: { moderation: 'auto' },
    })

    expect(bus.published).toEqual([])
  })

  /**
   * A moderator was handed a laptop to approve photos for the evening. Turning
   * moderation off, or setting retention to a day, is the host's decision — otherwise
   * lending out the console is the same thing as handing over the event.
   */
  it('refuses a moderator of the event', async () => {
    const result = await updateEventSettings({
      eventId: WEDDING,
      actorId: MODERATOR,
      patch: { moderation: 'auto' },
    })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('changes nothing when a moderator tries', async () => {
    await updateEventSettings({
      eventId: WEDDING,
      actorId: MODERATOR,
      patch: { moderation: 'auto' },
    })

    const stored = await events.findById(WEDDING)

    expect(stored?.settings.moderation).toBe('manual')
  })

  /**
   * `notFound`, not `forbidden`: confirming that an event exists to someone with no
   * part in it turns this into an enumeration oracle for other people's events.
   */
  it('answers notFound to a caller with no membership in the event', async () => {
    const result = await updateEventSettings({
      eventId: WEDDING,
      actorId: asUserId('user-nobody'),
      patch: { moderation: 'auto' },
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('cannot reach another event with the role the caller holds on their own', async () => {
    const result = await updateEventSettings({
      eventId: GALA,
      actorId: OWNER,
      patch: { moderation: 'auto' },
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('leaves another event untouched when the caller has no part in it', async () => {
    await updateEventSettings({ eventId: GALA, actorId: OWNER, patch: { moderation: 'auto' } })

    const stored = await events.findById(GALA)

    expect(stored?.settings.moderation).toBe('manual')
  })

  it('answers notFound for an event id that does not exist', async () => {
    const result = await updateEventSettings({
      eventId: asEventId('evt-nothing'),
      actorId: OWNER,
      patch: { moderation: 'auto' },
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
