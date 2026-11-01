import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { AT, anEvent } from '../../application/testing/builders'
import { CapturingLogger } from '../../application/testing/capturingLogger'
import { FakeEventRepository } from '../../application/testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../application/testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../application/testing/recordingEventBus'
import { EVENT_LOGO } from '../../application/ports/mediaStore'
import { makeGetEventLogoMedia } from '../../application/usecases/brand/getEventLogoMedia'
import { makeSetEventLogo, type SetEventLogo } from '../../application/usecases/brand/setEventLogo'
import { sha256ContentHasher } from '../crypto/sha256ContentHasher'
import { createFsMediaStore } from './fsMediaStore'
import { createSharpImageProcessor } from './sharpImageProcessor'
import { PAYLOADS, asFileBytes } from './testPayloads'

/**
 * A host's logo through the real pipeline: real `sharp`, real magic bytes, a real temporary
 * directory. What the in-memory doubles cannot say is whether the bytes that reach the disk are
 * the ones the rules describe, so this reads them back.
 */

const EVENT = asEventId('evt-logo')
const OWNER = asUserId('user-host')
const MAX_PIXELS = 50_000_000

/** A logo made on a phone: a PNG with transparent corners is the common case, a JPEG the other. */
const transparentPng = async (width: number, height: number): Promise<Uint8Array> =>
  new Uint8Array(
    await sharp({
      create: { width, height, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
          })
            .png()
            .toBuffer(),
          left: 5,
          top: 5,
        },
      ])
      .png()
      .toBuffer(),
  )

const phoneJpeg = async (width: number, height: number, orientation: number): Promise<Uint8Array> =>
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

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>',
)

describe('the host logo, through the real image pipeline', () => {
  let root: string
  let events: FakeEventRepository
  let setEventLogo: SetEventLogo
  let media: ReturnType<typeof createFsMediaStore>

  const build = (maxPixels: number): SetEventLogo => {
    const memberships = new FakeMembershipRepository()
    memberships.seed({ eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT })
    return makeSetEventLogo({
      events,
      memberships,
      media,
      imageProcessor: createSharpImageProcessor({ maxPixels: MAX_PIXELS }),
      hasher: sha256ContentHasher,
      bus: new RecordingEventBus(),
      logger: new CapturingLogger(),
      limits: { maxPixels },
    })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-logo-'))
    media = createFsMediaStore({ root })
    events = new FakeEventRepository()
    events.seed(anEvent({ id: EVENT, ownerId: OWNER }))
    setEventLogo = build(MAX_PIXELS)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const storedBytes = async (): Promise<Uint8Array> => {
    const hash = (await events.findById(EVENT))?.settings.logo
    if (hash === null || hash === undefined) throw new Error('no logo was stored')
    const bytes = await media.read(EVENT, hash, EVENT_LOGO)
    if (bytes === null) throw new Error('the named file is not on the disk')
    return bytes
  }

  it('stores a WebP that fits 640 by 320, whatever the upload was', async () => {
    const result = await setEventLogo({
      eventId: EVENT,
      actorId: OWNER,
      bytes: await phoneJpeg(2000, 1000, 1),
    })

    expect(result.ok).toBe(true)
    const stored = await sharp(await storedBytes()).metadata()
    expect(stored.format).toBe('webp')
    expect([stored.width, stored.height]).toEqual([640, 320])
  })

  it('does not enlarge a small logo', async () => {
    await setEventLogo({ eventId: EVENT, actorId: OWNER, bytes: await transparentPng(200, 100) })

    const stored = await sharp(await storedBytes()).metadata()
    expect([stored.width, stored.height]).toEqual([200, 100])
  })

  it('keeps the transparency of a PNG', async () => {
    // The guard against a future `flatten`: a logo on a plaque must not come back with a black
    // or white box around it.
    await setEventLogo({ eventId: EVENT, actorId: OWNER, bytes: await transparentPng(200, 100) })

    const stored = await sharp(await storedBytes()).metadata()
    expect(stored.hasAlpha).toBe(true)
    const corner = await sharp(await storedBytes())
      .ensureAlpha()
      .extract({ left: 150, top: 60, width: 1, height: 1 })
      .raw()
      .toBuffer()
    expect(corner[3]).toBe(0)
  })

  it('strips the EXIF block and the GPS position', async () => {
    await setEventLogo({ eventId: EVENT, actorId: OWNER, bytes: await phoneJpeg(800, 600, 6) })

    const stored = await sharp(await storedBytes()).metadata()
    expect(stored.exif).toBeUndefined()
    expect(stored.orientation).toBeUndefined()
    expect(Buffer.from(await storedBytes()).includes(Buffer.from('EventSlide Test'))).toBe(false)
  })

  it('bakes the orientation in', async () => {
    await setEventLogo({ eventId: EVENT, actorId: OWNER, bytes: await phoneJpeg(300, 200, 6) })

    const stored = await sharp(await storedBytes()).metadata()
    expect([stored.width, stored.height]).toEqual([200, 300].map((side) => Math.min(side, 320)))
  })

  it('identifies the file by its bytes: a script named logo.png is refused and writes nothing', async () => {
    const result = await setEventLogo({
      eventId: EVENT,
      actorId: OWNER,
      bytes: asFileBytes(PAYLOADS.phpWebShell),
    })

    expect(!result.ok && result.error.code).toBe('image.unsupportedFormat')
    expect(await media.list(EVENT)).toEqual([])
    expect((await events.findById(EVENT))?.settings.logo).toBeNull()
  })

  it('refuses an SVG, which is code and never an image this pipeline identifies', async () => {
    const result = await setEventLogo({ eventId: EVENT, actorId: OWNER, bytes: SVG })

    expect(!result.ok && result.error.code).toBe('image.unsupportedFormat')
    expect(await media.list(EVENT)).toEqual([])
  })

  it('refuses a pixel bomb on its header, before anything is decoded or written', async () => {
    const small = build(1_000)

    const result = await small({
      eventId: EVENT,
      actorId: OWNER,
      bytes: await transparentPng(200, 100),
    })

    expect(!result.ok && result.error.code).toBe('photo.pixelBudgetExceeded')
    expect(await media.list(EVENT)).toEqual([])
  })

  it('is served by the event that holds it and by no other', async () => {
    await setEventLogo({ eventId: EVENT, actorId: OWNER, bytes: await transparentPng(200, 100) })
    const event = await events.findById(EVENT)
    const hash = event?.settings.logo
    if (event === null || hash === null || hash === undefined) throw new Error('fixture')
    const get = makeGetEventLogoMedia({ media })

    const own = await get({ event, hash, viewer: { kind: 'public' } })
    const other = await get({
      event: anEvent({
        id: asEventId('evt-other'),
        slug: 'gala',
        joinCode: 'Z3N9PT',
        settings: { logo: hash },
      }),
      hash,
      viewer: { kind: 'public' },
    })

    expect(own.ok && own.value.contentType).toBe('image/webp')
    expect(!other.ok && other.error.code).toBe('logo.notFound')
  })
})
