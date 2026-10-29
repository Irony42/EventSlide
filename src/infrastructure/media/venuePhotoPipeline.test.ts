import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_EVENT_THEME } from '../../domain/events/eventTheme'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { AT, anEvent } from '../../application/testing/builders'
import { CapturingLogger } from '../../application/testing/capturingLogger'
import { FakeEventRepository } from '../../application/testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../application/testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../application/testing/recordingEventBus'
import { VENUE_GROUND } from '../../application/ports/mediaStore'
import { makeSetVenuePhoto, type SetVenuePhoto } from '../../application/usecases/venue/setVenuePhoto'
import { makeGetVenuePhotoMedia } from '../../application/usecases/venue/getVenuePhotoMedia'
import { sha256ContentHasher } from '../crypto/sha256ContentHasher'
import { createFsMediaStore } from './fsMediaStore'
import { createSharpImageProcessor } from './sharpImageProcessor'
import { PAYLOADS, asFileBytes } from './testPayloads'

/**
 * A host's venue photograph through the real pipeline: real `sharp`, real magic bytes, a real
 * temporary directory. What the in-memory doubles cannot say is whether the bytes that reach
 * the disk are the ones the rules describe, so this reads them back.
 */

const EVENT = asEventId('evt-venue')
const OWNER = asUserId('user-host')

/** A phone photograph of a venue: sideways, with the GPS block a camera writes. */
const phonePhoto = async (width: number, height: number, orientation: number): Promise<Uint8Array> =>
  new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: 30, g: 90, b: 200 } },
    })
      .withMetadata({
        orientation,
        exif: {
          IFD0: { Make: 'EventSlide Test', Model: 'Fixture 1', Artist: 'The Host' },
          IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
        },
      })
      .jpeg()
      .toBuffer(),
  )

describe('the venue photograph, through the real image pipeline', () => {
  let root: string
  let events: FakeEventRepository
  let setVenuePhoto: SetVenuePhoto
  let media: ReturnType<typeof createFsMediaStore>

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-venue-'))
    media = createFsMediaStore({ root })
    events = new FakeEventRepository()
    const memberships = new FakeMembershipRepository()
    memberships.seed({ eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT })
    events.seed(
      anEvent({
        id: EVENT,
        ownerId: OWNER,
        settings: { theme: { ...DEFAULT_EVENT_THEME, ambiance: 'guinguette' } },
      }),
    )
    setVenuePhoto = makeSetVenuePhoto({
      events,
      memberships,
      media,
      imageProcessor: createSharpImageProcessor({ maxPixels: 50_000_000 }),
      hasher: sha256ContentHasher,
      bus: new RecordingEventBus(),
      logger: new CapturingLogger(),
      limits: { maxPixels: 50_000_000 },
    })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const storedBytes = async (): Promise<Uint8Array> => {
    const hash = (await events.findById(EVENT))?.settings.venuePhoto
    if (hash === null || hash === undefined) throw new Error('no venue photograph was stored')
    const bytes = await media.read(EVENT, hash, VENUE_GROUND)
    if (bytes === null) throw new Error('the named file is not on the disk')
    return bytes
  }

  it('stores a WebP no wider than 1600 px, whatever the upload was', async () => {
    const result = await setVenuePhoto({
      eventId: EVENT,
      actorId: OWNER,
      bytes: await phonePhoto(4000, 3000, 1),
    })

    expect(result.ok).toBe(true)
    const stored = await sharp(await storedBytes()).metadata()
    expect(stored.format).toBe('webp')
    expect([stored.width, stored.height]).toEqual([1600, 1200])
  })

  it('strips the EXIF block and the GPS position of the venue', async () => {
    await setVenuePhoto({
      eventId: EVENT,
      actorId: OWNER,
      bytes: await phonePhoto(800, 600, 6),
    })

    const stored = await sharp(await storedBytes()).metadata()
    expect(stored.exif).toBeUndefined()
    expect(stored.orientation).toBeUndefined()
    expect(Buffer.from(await storedBytes()).includes(Buffer.from('EventSlide Test'))).toBe(false)
  })

  it('bakes the orientation in, so a sideways phone photograph is stored upright', async () => {
    // 800 x 600 with orientation 6 is a portrait photograph: 600 wide, 800 tall once rotated.
    await setVenuePhoto({
      eventId: EVENT,
      actorId: OWNER,
      bytes: await phonePhoto(800, 600, 6),
    })

    const stored = await sharp(await storedBytes()).metadata()
    expect([stored.width, stored.height]).toEqual([600, 800])
  })

  it('does not enlarge a small photograph', async () => {
    await setVenuePhoto({ eventId: EVENT, actorId: OWNER, bytes: await phonePhoto(320, 200, 1) })

    const stored = await sharp(await storedBytes()).metadata()
    expect([stored.width, stored.height]).toEqual([320, 200])
  })

  it('identifies the file by its bytes: a script named photo.jpg is refused and writes nothing', async () => {
    const result = await setVenuePhoto({
      eventId: EVENT,
      actorId: OWNER,
      bytes: asFileBytes(PAYLOADS.phpWebShell),
    })

    expect(!result.ok && result.error.code).toBe('image.unsupportedFormat')
    expect(await media.list(EVENT)).toEqual([])
    expect((await events.findById(EVENT))?.settings.venuePhoto).toBeNull()
  })

  it('is served by the event that holds it and by no other', async () => {
    await setVenuePhoto({ eventId: EVENT, actorId: OWNER, bytes: await phonePhoto(800, 600, 1) })
    const event = await events.findById(EVENT)
    const hash = event?.settings.venuePhoto
    if (event === null || hash === null || hash === undefined) throw new Error('fixture')
    const get = makeGetVenuePhotoMedia({ media })

    const own = await get({ event, hash, viewer: { kind: 'public' } })
    const other = await get({
      event: anEvent({
        id: asEventId('evt-other'),
        slug: 'gala',
        joinCode: 'Z3N9PT',
        settings: { venuePhoto: hash },
      }),
      hash,
      viewer: { kind: 'public' },
    })

    expect(own.ok && own.value.contentType).toBe('image/webp')
    expect(!other.ok && other.error.code).toBe('venuePhoto.notFound')
  })
})
