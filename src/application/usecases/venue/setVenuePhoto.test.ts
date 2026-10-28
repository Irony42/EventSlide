import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_EVENT_THEME } from '../../../domain/events/eventTheme'
import { ContentHash } from '../../../domain/photos/contentHash'
import { DomainError } from '../../../domain/shared/errors'
import { EventName } from '../../../domain/events/eventName'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent, type EventInput } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeContentHasher } from '../../testing/fakeContentHasher'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeImageProcessor, tagBytes } from '../../testing/fakeImageProcessor'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import {
  MAX_VENUE_PHOTO_BYTES,
  VENUE_GROUND_SPEC,
  makeSetVenuePhoto,
  type SetVenuePhoto,
} from './setVenuePhoto'

const WEDDING = asEventId('evt-wedding')
const OTHER = asEventId('evt-other')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')
const MAX_PIXELS = 50_000_000

const GUINGUETTE: EventInput['settings'] = {
  theme: { ...DEFAULT_EVENT_THEME, ambiance: 'guinguette' },
}

/** An event whose save fails, as a locked database does after the media has been written. */
class LockedEventRepository extends FakeEventRepository {
  override async save(): Promise<void> {
    throw new Error('SQLITE_BUSY: database is locked')
  }
}

describe('setVenuePhoto', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let media: InMemoryMediaStore
  let images: FakeImageProcessor
  let hasher: FakeContentHasher
  let bus: RecordingEventBus
  let logger: CapturingLogger
  let setVenuePhoto: SetVenuePhoto

  const build = (repository: FakeEventRepository = events): void => {
    setVenuePhoto = makeSetVenuePhoto({
      events: repository,
      memberships,
      media,
      imageProcessor: images,
      hasher,
      bus,
      logger,
      limits: { maxPixels: MAX_PIXELS },
    })
  }

  /** The digest the stored ground of `tag` will have. */
  const digestOf = (tag: string): ContentHash => {
    const made = ContentHash.create(hasher.sha256Hex(images.renderedBytes(tag, 'ground')))
    if (!made.ok) throw new Error('fixture digest')
    return made.value
  }

  const seedEvent = (input: EventInput = {}): void => {
    events.seed(anEvent({ id: WEDDING, ownerId: OWNER, settings: GUINGUETTE, ...input }))
  }

  beforeEach(() => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    media = new InMemoryMediaStore()
    images = new FakeImageProcessor()
    hasher = new FakeContentHasher()
    bus = new RecordingEventBus()
    logger = new CapturingLogger()
    memberships.seed(
      { eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
      { eventId: OTHER, userId: STRANGER, role: 'owner', grantedAt: AT },
    )
    seedEvent()
    build()
  })

  it('stores the rendered ground under the event and names it in the settings', async () => {
    const result = await setVenuePhoto({
      eventId: WEDDING,
      actorId: OWNER,
      bytes: tagBytes('guinguette-du-lac'),
    })

    const digest = digestOf('guinguette-du-lac')
    expect(result.ok && result.value.settings.venuePhoto?.value).toBe(digest.value)
    expect((await events.findById(WEDDING))?.settings.venuePhoto?.value).toBe(digest.value)
    expect(media.variantsOf(WEDDING, digest)).toEqual(['ground'])
  })

  it('stores what the pipeline rendered and never the upload', async () => {
    // The stored bytes are the pipeline's output, so a polyglot or a file carrying the
    // venue's GPS position cannot survive: the upload itself is never written anywhere.
    await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('raw-upload') })

    const stored = await media.read(WEDDING, digestOf('raw-upload'), 'ground')
    expect(stored).toEqual(images.renderedBytes('raw-upload', 'ground'))
    expect(media.objectCount).toBe(1)
  })

  it('renders at the ground size, in WebP, after reading the header', async () => {
    await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('pic') })

    expect(VENUE_GROUND_SPEC).toMatchObject({ maxWidth: 1600, format: 'webp' })
    expect(images.calls).toEqual(['probe:pic', 'render:pic:ground'])
  })

  it('announces the change so the wall and the guests refetch the theme', async () => {
    await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('pic') })

    expect(bus.published).toEqual([{ type: 'event.settingsChanged', eventId: WEDDING }])
  })

  it('removes the previous photograph once the new one is the one the settings name', async () => {
    await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('first') })
    await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('second') })

    expect(media.variantsOf(WEDDING, digestOf('first'))).toEqual([])
    expect(media.variantsOf(WEDDING, digestOf('second'))).toEqual(['ground'])
    expect(media.objectCount).toBe(1)
  })

  it('keeps the file when the same photograph is sent again', async () => {
    // Same bytes, same digest: "replacing" the file with itself must not delete it.
    await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('same') })
    const again = await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('same') })

    expect(again.ok).toBe(true)
    expect(media.variantsOf(WEDDING, digestOf('same'))).toEqual(['ground'])
  })

  describe('who and when', () => {
    it('refuses a moderator, who may not change how the evening looks', async () => {
      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: MODERATOR,
        bytes: tagBytes('pic'),
      })

      expect(!result.ok && result.error.kind).toBe('forbidden')
      expect(media.objectCount).toBe(0)
    })

    it('answers notFound, not forbidden, for an account with no part in the event', async () => {
      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: STRANGER,
        bytes: tagBytes('pic'),
      })

      expect(!result.ok && result.error.code).toBe('event.notFound')
      expect(images.calls).toEqual([])
    })

    it('answers notFound for an event that does not exist', async () => {
      const result = await setVenuePhoto({
        eventId: asEventId('evt-absent'),
        actorId: OWNER,
        bytes: tagBytes('pic'),
      })

      expect(!result.ok && result.error.code).toBe('event.notFound')
    })

    it('refuses an archived event, which is a record', async () => {
      events.seed(
        anEvent({
          id: OTHER,
          ownerId: STRANGER,
          slug: 'gala-annuel',
          joinCode: 'Z3N9PT',
          status: 'archived',
          settings: GUINGUETTE,
        }),
      )

      const result = await setVenuePhoto({
        eventId: OTHER,
        actorId: STRANGER,
        bytes: tagBytes('pic'),
      })

      expect(!result.ok && result.error.code).toBe('event.immutable')
    })
  })

  describe('the file', () => {
    it('refuses what the header says is not an image, before decoding anything', async () => {
      images.script('shell.php', { probeError: DomainError.invalid('image.unsupportedFormat') })

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('shell.php'),
      })

      expect(!result.ok && result.error.code).toBe('image.unsupportedFormat')
      expect(images.calls).toEqual(['probe:shell.php'])
      expect(media.objectCount).toBe(0)
    })

    it('refuses a header that declares more pixels than the budget, undecoded', async () => {
      images.script('bomb', { width: 20_000, height: 20_000 })

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('bomb'),
      })

      expect(!result.ok && result.error.code).toBe('photo.pixelBudgetExceeded')
      expect(images.calls).toEqual(['probe:bomb'])
    })

    it('reports a render that fails and writes nothing', async () => {
      images.script('broken', { groundRenderFails: true })

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('broken'),
      })

      expect(!result.ok && result.error.code).toBe('image.renderFailed')
      expect(media.objectCount).toBe(0)
    })

    it('refuses a ground heavier than the bound documented for it', async () => {
      images.script('huge', { groundByteSize: MAX_VENUE_PHOTO_BYTES + 1 })

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('huge'),
      })

      expect(!result.ok && result.error.code).toBe('venuePhoto.tooLarge')
      expect(media.objectCount).toBe(0)
    })

    it('accepts a ground exactly at the bound', async () => {
      images.script('edge', { groundByteSize: MAX_VENUE_PHOTO_BYTES })

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('edge'),
      })

      expect(result.ok).toBe(true)
    })
  })

  describe('tenant isolation', () => {
    it('writes under the event that is being set and under no other', async () => {
      await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('pic') })

      expect(await media.list(OTHER)).toEqual([])
      expect((await media.list(WEDDING)).map((object) => object.variant)).toEqual(['ground'])
    })

    it('leaves another event`s photograph alone when two events upload the same file', async () => {
      events.seed(
        anEvent({
          id: OTHER,
          ownerId: STRANGER,
          slug: 'gala',
          joinCode: 'Z3N9PT',
          settings: GUINGUETTE,
        }),
      )
      await setVenuePhoto({ eventId: OTHER, actorId: STRANGER, bytes: tagBytes('pic') })

      await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('pic') })
      await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('other') })

      expect(media.variantsOf(OTHER, digestOf('pic'))).toEqual(['ground'])
    })
  })

  describe('while the file is being processed', () => {
    /** Something else happens to the event during the write: the seconds an upload really takes. */
    const duringTheWrite = (act: () => Promise<void>): void => {
      const put = media.put.bind(media)
      media.put = async (...args) => {
        await put(...args)
        await act()
      }
    }

    it('keeps what the host or the schedule did to the event meanwhile, and does not save a stale copy', async () => {
      duringTheWrite(async () => {
        const current = await events.findById(WEDDING)
        const name = EventName.create('Un autre nom')
        const renamed = name.ok ? current?.rename(name.value) : undefined
        if (renamed === undefined || !renamed.ok) throw new Error('fixture')
        await events.save(renamed.value)
      })

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('pic'),
      })

      expect(result.ok).toBe(true)
      const stored = await events.findById(WEDDING)
      expect(stored?.name.value).toBe('Un autre nom')
      expect(stored?.settings.venuePhoto?.value).toBe(digestOf('pic').value)
    })

    it('removes the file when the event was purged in the meantime', async () => {
      duringTheWrite(() => events.delete(WEDDING))

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('pic'),
      })

      expect(!result.ok && result.error.code).toBe('event.notFound')
      expect(media.objectCount).toBe(0)
    })

    it('removes the file when the event was archived in the meantime', async () => {
      duringTheWrite(async () => {
        const archived = (await events.findById(WEDDING))?.archive(AT)
        if (archived === undefined || !archived.ok) throw new Error('fixture')
        await events.save(archived.value)
      })

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('pic'),
      })

      expect(!result.ok && result.error.code).toBe('event.immutable')
      expect(media.objectCount).toBe(0)
    })
  })

  describe('failure', () => {
    it('answers a media write that fails, and the settings are untouched', async () => {
      media.failWritesAfter(0)

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('pic'),
      })

      expect(!result.ok && result.error.code).toBe('photo.mediaWriteFailed')
      expect((await events.findById(WEDDING))?.settings.venuePhoto).toBeNull()
      expect(bus.published).toEqual([])
    })

    /** A locked repository holding an event whose settings already name `tag`'s ground. */
    const lockedNaming = async (tag: string): Promise<void> => {
      await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes(tag) })
      const named = (await events.findById(WEDDING))?.settings
      if (named === undefined) throw new Error('fixture')
      const locked = new LockedEventRepository()
      locked.seed(anEvent({ id: WEDDING, ownerId: OWNER, settings: named }))
      build(locked)
      bus.published.length = 0
    }

    it('removes the file it wrote when the save fails, and keeps the one still named', async () => {
      await lockedNaming('first')

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('second'),
      })

      expect(!result.ok && result.error.code).toBe('venuePhoto.saveFailed')
      expect(media.variantsOf(WEDDING, digestOf('second'))).toEqual([])
      expect(media.variantsOf(WEDDING, digestOf('first'))).toEqual(['ground'])
      expect(bus.published).toEqual([])
    })

    it('does not take back a photograph the stored settings already name when the save fails', async () => {
      await lockedNaming('same')

      await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('same') })

      expect(media.variantsOf(WEDDING, digestOf('same'))).toEqual(['ground'])
    })

    it('still succeeds when the previous file cannot be unlinked, and says so', async () => {
      await setVenuePhoto({ eventId: WEDDING, actorId: OWNER, bytes: tagBytes('first') })
      media.failDeletes()

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('second'),
      })

      expect(result.ok).toBe(true)
      expect(logger.lines.some((line) => line.level === 'warn')).toBe(true)
    })

    it('treats a hasher that returns no digest as a broken adapter, not a bad photograph', async () => {
      hasher.returnGarbage()

      const result = await setVenuePhoto({
        eventId: WEDDING,
        actorId: OWNER,
        bytes: tagBytes('pic'),
      })

      expect(!result.ok && result.error.code).toBe('photo.hashFailed')
      expect(logger.lines.some((line) => line.level === 'error')).toBe(true)
      expect(media.objectCount).toBe(0)
    })
  })
})
