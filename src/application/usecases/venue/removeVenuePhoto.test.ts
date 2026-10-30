import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import { DEFAULT_EVENT_THEME } from '../../../domain/events/eventTheme'
import { ContentHash } from '../../../domain/photos/contentHash'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeRemoveVenuePhoto, type RemoveVenuePhoto } from './removeVenuePhoto'

const WEDDING = asEventId('evt-wedding')
const OTHER = asEventId('evt-other')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

const digest = (seed: string): ContentHash => {
  const made = ContentHash.create(seed.padEnd(64, '0'))
  if (!made.ok) throw new Error('fixture digest')
  return made.value
}
const PHOTO = digest('a1')

describe('removeVenuePhoto', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let media: InMemoryMediaStore
  let bus: RecordingEventBus
  let logger: CapturingLogger
  let removeVenuePhoto: RemoveVenuePhoto

  beforeEach(async () => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    media = new InMemoryMediaStore()
    bus = new RecordingEventBus()
    logger = new CapturingLogger()
    removeVenuePhoto = makeRemoveVenuePhoto({ events, memberships, media, bus, logger })
    memberships.seed(
      { eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
      { eventId: OTHER, userId: STRANGER, role: 'owner', grantedAt: AT },
    )
    events.seed(
      anEvent({
        id: WEDDING,
        ownerId: OWNER,
        settings: {
          theme: { ...DEFAULT_EVENT_THEME, ambiance: 'guinguette' },
          venuePhoto: PHOTO,
        },
      }),
    )
    await media.put(WEDDING, PHOTO, 'ground', Uint8Array.of(1, 2, 3))
  })

  it('takes the photograph out of the settings and off the disk', async () => {
    const result = await removeVenuePhoto({ eventId: WEDDING, actorId: OWNER })

    expect(result.ok && result.value.settings.venuePhoto).toBeNull()
    expect((await events.findById(WEDDING))?.settings.venuePhoto).toBeNull()
    expect(media.objectCount).toBe(0)
  })

  it('refuses an event the operator took down as one that is not there, and a frozen client event with 403 client.suspended', async () => {
    await events.setTakenDown(WEDDING, AT)
    const down = await removeVenuePhoto({ eventId: WEDDING, actorId: OWNER })
    await events.setTakenDown(WEDDING, null)
    const frozenEvents = new FakeEventRepository().seed(
      Event.restore({
        ...anEvent({ id: WEDDING, ownerId: OWNER }).toProps(),
        clientSuspendedAt: AT,
      }),
    )
    const frozen = await makeRemoveVenuePhoto({
      events: frozenEvents,
      memberships,
      media,
      bus,
      logger,
    })({ eventId: WEDDING, actorId: OWNER })

    expect(!down.ok && down.error.code).toBe('event.notFound')
    expect(!frozen.ok && frozen.error.code).toBe('client.suspended')
  })

  it('refuses while the operator holds the purge, with a failure a host can already get, and keeps the file (launch review S5)', async () => {
    await events.setPurgeHeld(WEDDING, AT)

    const result = await removeVenuePhoto({ eventId: WEDDING, actorId: OWNER })

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'unexpected',
      'venuePhoto.saveFailed',
    ])
    expect((await events.findById(WEDDING))?.settings.venuePhoto).not.toBeNull()
    expect(media.objectCount).toBe(1)
  })

  it('keeps the rest of the theme, so the host is back on the bundled ground and nothing else', async () => {
    await removeVenuePhoto({ eventId: WEDDING, actorId: OWNER })

    expect((await events.findById(WEDDING))?.settings.theme.ambiance).toBe('guinguette')
  })

  it('announces the change', async () => {
    await removeVenuePhoto({ eventId: WEDDING, actorId: OWNER })

    expect(bus.published).toEqual([{ type: 'event.settingsChanged', eventId: WEDDING }])
  })

  it('is idempotent: removing what is not there changes and announces nothing', async () => {
    await removeVenuePhoto({ eventId: WEDDING, actorId: OWNER })
    bus.published.length = 0

    const again = await removeVenuePhoto({ eventId: WEDDING, actorId: OWNER })

    expect(again.ok).toBe(true)
    expect(bus.published).toEqual([])
  })

  it('refuses a moderator', async () => {
    const result = await removeVenuePhoto({ eventId: WEDDING, actorId: MODERATOR })

    expect(!result.ok && result.error.kind).toBe('forbidden')
    expect((await events.findById(WEDDING))?.settings.venuePhoto?.value).toBe(PHOTO.value)
    expect(media.objectCount).toBe(1)
  })

  it('answers notFound for an account with no part in the event, and for no such event', async () => {
    const stranger = await removeVenuePhoto({ eventId: WEDDING, actorId: STRANGER })
    const absent = await removeVenuePhoto({ eventId: asEventId('evt-absent'), actorId: OWNER })

    expect(!stranger.ok && stranger.error.code).toBe('event.notFound')
    expect(!absent.ok && absent.error.code).toBe('event.notFound')
    expect(media.objectCount).toBe(1)
  })

  it('refuses an archived event, which is a record, when it holds a photograph', async () => {
    events.seed(
      anEvent({
        id: OTHER,
        ownerId: STRANGER,
        slug: 'gala-annuel',
        joinCode: 'Z3N9PT',
        status: 'archived',
        settings: { venuePhoto: PHOTO },
      }),
    )

    const result = await removeVenuePhoto({ eventId: OTHER, actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.immutable')
  })

  it('succeeds when the file cannot be unlinked, because the row no longer names it', async () => {
    media.failDeletes()

    const result = await removeVenuePhoto({ eventId: WEDDING, actorId: OWNER })

    expect(result.ok).toBe(true)
    expect((await events.findById(WEDDING))?.settings.venuePhoto).toBeNull()
    expect(logger.lines.some((line) => line.level === 'warn')).toBe(true)
  })

  it('only ever deletes under the event it was asked about', async () => {
    await media.put(OTHER, PHOTO, 'ground', Uint8Array.of(9))

    await removeVenuePhoto({ eventId: WEDDING, actorId: OWNER })

    expect(media.variantsOf(OTHER, PHOTO)).toEqual(['ground'])
  })
})
