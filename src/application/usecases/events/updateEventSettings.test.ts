import { beforeEach, describe, expect, it } from 'vitest'
import type { ClientCeilingsProps } from '../../../domain/clients/clientCeilings'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, anEvent } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
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
  let clients: FakeClientRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let updateEventSettings: UpdateEventSettings

  beforeEach(async () => {
    clients = new FakeClientRepository()
    events = new FakeEventRepository({ clients })
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    updateEventSettings = makeUpdateEventSettings({ events, clients, memberships, bus })

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

  // ------------------------------------------------------ a client’s ceilings --

  /**
   * What a host may set on an event of a client (roadmap §10.5 / G2-05). Unlike creation,
   * where a value nobody chose is reduced, an edit is **refused**: shortening what a host
   * just typed would tell them they got what they asked for. The wedding belongs to
   * **client-1**; the gala to nobody.
   */
  describe('an event of a client with ceilings', () => {
    /** The client's own event: the wedding above has none, and an event keeps the client it was made with. */
    const CLIENT_EVENT = asEventId('evt-client')

    const withCeilings = async (
      ceilings: Partial<ClientCeilingsProps>,
      settings: Parameters<typeof anEvent>[0] = {},
    ): Promise<void> => {
      clients.seed(aClient({ id: 'client-1', ceilings }))
      events.seed(
        anEvent({
          id: CLIENT_EVENT,
          ownerId: OWNER,
          slug: 'soiree-cliente',
          joinCode: 'K8M3NP',
          clientId: 'client-1',
          ...settings,
        }),
      )
      await memberships.grant({
        eventId: CLIENT_EVENT,
        userId: OWNER,
        role: 'owner',
        grantedAt: AT,
      })
    }

    const update = (patch: Parameters<UpdateEventSettings>[0]['patch']) =>
      updateEventSettings({ eventId: CLIENT_EVENT, actorId: OWNER, patch })

    describe('retention', () => {
      it('accepts a retention exactly at max_retention_days', async () => {
        await withCeilings({ maxRetentionDays: 30 })

        const result = await update({ retentionDays: 30 })

        expect(result.ok && result.value.settings.retentionDays).toBe(30)
      })

      it('refuses a retention one day over it with 400 client.retentionAboveCeiling, naming the bound', async () => {
        await withCeilings({ maxRetentionDays: 30 })

        const result = await update({ retentionDays: 31 })

        expect(!result.ok && result.error.code).toBe('client.retentionAboveCeiling')
        expect(!result.ok && result.error.kind).toBe('invalid')
        expect(!result.ok && result.error.details).toEqual({ maxDays: 30 })
      })

      it('refuses “keep for ever” once a ceiling exists, because forever is what it is for', async () => {
        await withCeilings({ maxRetentionDays: 30 })

        const result = await update({ retentionDays: null })

        expect(!result.ok && result.error.code).toBe('client.retentionAboveCeiling')
      })

      it('stores and announces nothing for a retention it refuses', async () => {
        await withCeilings({ maxRetentionDays: 30 })

        await update({ retentionDays: 31 })

        expect((await events.findById(CLIENT_EVENT))?.settings.retentionDays).toBeNull()
        expect(bus.published).toEqual([])
      })

      it('accepts a shorter retention than the ceiling', async () => {
        await withCeilings({ maxRetentionDays: 30 })

        expect((await update({ retentionDays: 7 })).ok).toBe(true)
      })

      it('does not refuse an edit that leaves retention alone, even though the stored value is now above a lowered ceiling', async () => {
        // The ceiling was lowered after the host chose. The purge already honours the lower
        // number, so refusing an unrelated edit — moderation — would only lock the host out
        // of their own settings for something they did not touch.
        await withCeilings({ maxRetentionDays: 30 }, { settings: { retentionDays: 90 } })

        const result = await update({ moderation: 'auto' })

        expect(result.ok).toBe(true)
      })

      it('imposes nothing for a client with no max_retention_days', async () => {
        await withCeilings({ maxTotalBytes: 1_000 })

        expect((await update({ retentionDays: null })).ok).toBe(true)
        expect((await update({ retentionDays: 3_650 })).ok).toBe(true)
      })
    })

    describe('clips', () => {
      it('refuses switching allowClips on when the client may not have clips, 400 client.clipsNotAllowed', async () => {
        await withCeilings({ clipsAllowed: false })
        await update({ allowClips: false })

        const result = await update({ allowClips: true })

        expect(!result.ok && result.error.code).toBe('client.clipsNotAllowed')
        expect(!result.ok && result.error.kind).toBe('invalid')
      })

      it('lets the host leave it off, or switch it off, under such a client', async () => {
        await withCeilings({ clipsAllowed: false })

        const result = await update({ allowClips: false })

        expect(result.ok && result.value.settings.allowClips).toBe(false)
      })

      it('does not touch allowClips for a patch that does not mention it', async () => {
        await withCeilings({ clipsAllowed: false })

        expect((await update({ moderation: 'auto' })).ok).toBe(true)
      })

      it('lets a client that may have clips switch them on', async () => {
        await withCeilings({ clipsAllowed: true })
        await update({ allowClips: false })

        const result = await update({ allowClips: true })

        expect(result.ok && result.value.settings.allowClips).toBe(true)
      })
    })

    it('still answers an archived event with the lifecycle’s own conflict, before it asks about a ceiling', async () => {
      await withCeilings({ maxRetentionDays: 30 }, { status: 'archived' })

      const result = await update({ retentionDays: 90 })

      expect(!result.ok && result.error.code).toBe('event.immutable')
    })
  })

  describe('an event with no client', () => {
    it('is not limited by anything, whatever any client is held to', async () => {
      clients.seed(
        aClient({ id: 'client-1', ceilings: { maxRetentionDays: 1, clipsAllowed: false } }),
      )

      const result = await updateEventSettings({
        eventId: WEDDING,
        actorId: OWNER,
        patch: { retentionDays: 3_650, allowClips: true },
      })

      expect(result.ok && result.value.settings.retentionDays).toBe(3_650)
      expect(result.ok && result.value.settings.allowClips).toBe(true)
    })
  })
})
