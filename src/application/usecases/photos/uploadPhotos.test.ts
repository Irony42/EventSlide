import { beforeEach, describe, expect, it } from 'vitest'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { Dimensions } from '../../../domain/photos/dimensions'
import type { Photo, PhotoAuthor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestId, asUserId, type EventId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { ContentHasher } from '../../ports/contentHasher'
import type { ImageProbe, ImageProcessor, RenderSpec, RenderedImage } from '../../ports/imageProcessor'
import type { LogContext, Logger } from '../../ports/logger'
import type { PhotoAdmission, PhotoRefusal } from '../../ports/photoRepository'
import {
  MEDIA_VARIANTS,
  type MediaMetadata,
  type MediaStore,
  type MediaVariant,
} from '../../ports/mediaStore'
import { anEvent, aPhoto, type EventInput } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import {
  makeUploadPhotos,
  VARIANT_SPECS,
  type UploadFile,
  type UploadOutcome,
  type UploadPhotos,
  type UploadPhotosDeps,
  type UploadPhotosResult,
} from './uploadPhotos'

/**
 * Ingest is the highest-risk operation in the product: the only public write, it
 * decodes untrusted bytes, and it touches the disk. The tests are grouped by the gate
 * they protect, and each one states the rule rather than the mechanics.
 */

// ---------------------------------------------------------------- test doubles --

/** A file's bytes are its tag, so every double can answer deterministically for it. */
const tagBytes = (tag: string): Uint8Array =>
  Uint8Array.from([...tag].map((character) => character.charCodeAt(0)))

const readTag = (bytes: Uint8Array): string => String.fromCharCode(...bytes)

const must = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`fixture rejected by the domain: ${result.error.code}`)
  return result.value
}

/** Sums to exactly 1 MB per photo, so a quota expectation is arithmetic a reader can do. */
const DEFAULT_BYTE_SIZES: Readonly<Record<MediaVariant, number>> = {
  original: 900_000,
  display: 90_000,
  thumb: 10_000,
}

interface ImageScript {
  readonly width?: number
  readonly height?: number
  readonly probeError?: DomainError
  readonly renderErrorAt?: MediaVariant
  readonly byteSizes?: Readonly<Record<MediaVariant, number>>
}

/** Matched on the longest edge, so the double does not depend on object identity. */
const variantFor = (spec: RenderSpec): MediaVariant => {
  const match = MEDIA_VARIANTS.find((variant) => VARIANT_SPECS[variant].maxWidth === spec.maxWidth)
  if (match === undefined) throw new Error(`no variant renders at ${spec.maxWidth}px`)
  return match
}

/**
 * A deterministic `ImageProcessor`.
 *
 * `calls` is the point of it: the port's contract is an *order* — read the header, then
 * decode — and the only way to prove ingest honours it is to show that a refused file
 * produced no render call at all.
 */
class FakeImageProcessor implements ImageProcessor {
  readonly calls: string[] = []

  private readonly scripts = new Map<string, ImageScript>()

  script(tag: string, script: ImageScript): this {
    this.scripts.set(tag, script)
    return this
  }

  /** The exact bytes `render` will produce, so a test can pre-compute a content hash. */
  renderedBytes(tag: string, variant: MediaVariant): Uint8Array {
    return tagBytes(`${tag}/${variant}`)
  }

  async probe(bytes: Uint8Array): Promise<Result<ImageProbe, DomainError>> {
    const tag = readTag(bytes)
    this.calls.push(`probe:${tag}`)

    const script = this.scripts.get(tag) ?? {}
    if (script.probeError !== undefined) return { ok: false, error: script.probeError }

    return ok({
      format: 'jpeg',
      dimensions: this.dimensionsOf(script),
      hasAlpha: false,
      exifOrientation: 6,
      hasMetadata: true,
      frames: 1,
    })
  }

  async render(bytes: Uint8Array, spec: RenderSpec): Promise<Result<RenderedImage, DomainError>> {
    const tag = readTag(bytes)
    const variant = variantFor(spec)
    this.calls.push(`render:${tag}:${variant}`)

    const script = this.scripts.get(tag) ?? {}
    if (script.renderErrorAt === variant) {
      return { ok: false, error: DomainError.unexpected('image.renderFailed') }
    }

    const box = must(Dimensions.create(spec.maxWidth, spec.maxHeight))
    return ok({
      bytes: this.renderedBytes(tag, variant),
      dimensions: this.dimensionsOf(script).scaleToFit(box),
      byteSize: (script.byteSizes ?? DEFAULT_BYTE_SIZES)[variant],
      format: spec.format,
    })
  }

  private dimensionsOf(script: ImageScript): Dimensions {
    return must(Dimensions.create(script.width ?? 4032, script.height ?? 3024))
  }
}

class InMemoryMediaStore implements MediaStore {
  private readonly objects = new Map<string, Uint8Array>()

  /** Successful writes remaining before the store starts refusing them. */
  private budget = Number.POSITIVE_INFINITY

  /** Simulates a disk filling up part-way through a request. */
  failAfter(writes: number): this {
    this.budget = writes
    return this
  }

  /** Every variant currently held for one photo, in a stable order. */
  variantsOf(eventId: EventId, hash: ContentHash): readonly MediaVariant[] {
    return MEDIA_VARIANTS.filter((variant) => this.objects.has(this.key(eventId, hash, variant)))
  }

  get objectCount(): number {
    return this.objects.size
  }

  private key(eventId: EventId, hash: ContentHash, variant: MediaVariant): string {
    return `${eventId}|${hash.value}|${variant}`
  }

  async put(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
    bytes: Uint8Array,
  ): Promise<void> {
    if (this.budget <= 0) throw new Error('no space left on device')
    this.budget -= 1
    this.objects.set(this.key(eventId, hash, variant), bytes)
  }

  async exists(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<boolean> {
    return this.objects.has(this.key(eventId, hash, variant))
  }

  async stat(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<MediaMetadata | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    return bytes === undefined ? null : { byteSize: bytes.length, contentType: 'image/jpeg' }
  }

  async openRead(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<AsyncIterable<Uint8Array> | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    if (bytes === undefined) return null
    return (async function* () {
      yield bytes
    })()
  }

  async read(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<Uint8Array | null> {
    return this.objects.get(this.key(eventId, hash, variant)) ?? null
  }

  async delete(eventId: EventId, hash: ContentHash): Promise<void> {
    for (const variant of MEDIA_VARIANTS) this.objects.delete(this.key(eventId, hash, variant))
  }

  async deleteEvent(eventId: EventId): Promise<void> {
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(`${eventId}|`)) this.objects.delete(key)
    }
  }

  async usedBytes(eventId: EventId): Promise<number> {
    let total = 0
    for (const [key, bytes] of this.objects) {
      if (key.startsWith(`${eventId}|`)) total += bytes.length
    }
    return total
  }
}

/** FNV-1a widened to 64 hex characters: deterministic, and a real `ContentHash`. */
class FakeContentHasher implements ContentHasher {
  private malformed = false

  /** A broken adapter — the one hash failure that is not the guest's photo's fault. */
  returnGarbage(): this {
    this.malformed = true
    return this
  }

  sha256Hex(bytes: Uint8Array): string {
    if (this.malformed) return 'not-a-digest'

    let state = 2166136261
    let digest = ''
    while (digest.length < 64) {
      for (const byte of bytes) state = Math.imul(state ^ byte, 16777619) >>> 0
      state = Math.imul(state ^ digest.length, 16777619) >>> 0
      digest += state.toString(16).padStart(8, '0')
    }
    return digest.slice(0, 64)
  }
}

/** A locked database: `SQLITE_BUSY` on the insert, after the media has been written. */
class LockedPhotoRepository extends FakePhotoRepository {
  override async saveManyWithinLimits(): Promise<readonly PhotoAdmission[]> {
    throw new Error('SQLITE_BUSY: database is locked')
  }
}

/**
 * An event that filled up *while this request was rendering*.
 *
 * The real fake enforces the limits honestly; this one forces the outcome the race
 * produces — the write transaction turning a photo away after its media has already been
 * written — without depending on two requests interleaving in a particular order.
 */
class FullPhotoRepository extends FakePhotoRepository {
  constructor(private readonly refusal: PhotoRefusal) {
    super()
  }

  override async saveManyWithinLimits(
    _eventId: EventId,
    photos: readonly Photo[],
  ): Promise<readonly PhotoAdmission[]> {
    return photos.map((photo) => ({ photoId: photo.id, refusal: this.refusal }))
  }
}

/**
 * The byte-identical photo of another guest, committed between this request's duplicate
 * check and its write — and taking the last of the quota with it.
 */
class LostRacePhotoRepository extends FakePhotoRepository {
  constructor(private readonly winningHash: string) {
    super()
  }

  override async saveManyWithinLimits(
    eventId: EventId,
    photos: readonly Photo[],
  ): Promise<readonly PhotoAdmission[]> {
    await this.save(aPhoto({ id: 'winner', eventId, contentHash: this.winningHash }))
    return photos.map((photo) => ({
      photoId: photo.id,
      refusal: { reason: 'quotaExceeded', remaining: 0 },
    }))
  }
}

class CapturingLogger implements Logger {
  readonly lines: { level: string; message: string }[] = []

  debug(message: string): void {
    this.lines.push({ level: 'debug', message })
  }

  info(message: string): void {
    this.lines.push({ level: 'info', message })
  }

  warn(message: string): void {
    this.lines.push({ level: 'warn', message })
  }

  error(message: string): void {
    this.lines.push({ level: 'error', message })
  }

  child(_bindings: LogContext): Logger {
    return this
  }
}

// -------------------------------------------------------------------- helpers --

const EVENT = asEventId('event-1')
const OTHER_EVENT = asEventId('event-2')
const GUEST: PhotoAuthor = { kind: 'guest', guestId: asGuestId('guest-1') }
/** A second phone at the same party, for the two-uploads-at-once cases. */
const OTHER_GUEST: PhotoAuthor = { kind: 'guest', guestId: asGuestId('guest-2') }
const HOST: PhotoAuthor = { kind: 'host', userId: asUserId('user-1') }

/** The env default. A 4032 x 3024 phone photo is 12 Mpx; a 30 000² PNG is 900 Mpx. */
const MAX_PIXELS = 50_000_000

const aFile = (tag: string): UploadFile => ({ bytes: tagBytes(tag), declaredName: `${tag}.jpg` })

/** Narrowed for `noUncheckedIndexedAccess`, so a test never asserts on `undefined`. */
const only = <T>(items: readonly T[]): T => {
  const [first] = items
  if (first === undefined || items.length !== 1) {
    throw new Error(`expected exactly one item, got ${items.length}`)
  }
  return first
}

const outcomesOf = (
  result: Result<UploadPhotosResult, DomainError>,
): readonly UploadOutcome[] => {
  if (!result.ok) throw new Error(`expected per-file outcomes, got ${result.error.code}`)
  return result.value.outcomes
}

const kinds = (result: Result<UploadPhotosResult, DomainError>): readonly string[] =>
  outcomesOf(result).map((outcome) => outcome.kind)

const refusal = (result: Result<UploadPhotosResult, DomainError>, index = 0): DomainError => {
  const outcome = outcomesOf(result)[index]
  if (outcome === undefined || outcome.kind !== 'refused') {
    throw new Error(`expected file ${index} to be refused, it was ${outcome?.kind}`)
  }
  return outcome.error
}

describe('uploadPhotos', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore
  let images: FakeImageProcessor
  let hasher: FakeContentHasher
  let bus: RecordingEventBus
  let clock: FakeClock
  let ids: SequentialIdGenerator
  let logger: CapturingLogger
  let uploadPhotos: UploadPhotos

  const build = (overrides: Partial<UploadPhotosDeps> = {}): UploadPhotos =>
    makeUploadPhotos({
      events,
      photos,
      media,
      imageProcessor: images,
      hasher,
      bus,
      clock,
      ids,
      logger,
      limits: { maxPixels: MAX_PIXELS },
      ...overrides,
    })

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    media = new InMemoryMediaStore()
    images = new FakeImageProcessor()
    hasher = new FakeContentHasher()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    ids = new SequentialIdGenerator()
    logger = new CapturingLogger()
    uploadPhotos = build()
  })

  const seedEvent = (input: EventInput = {}): void => {
    events.seed(anEvent({ id: 'event-1', ...input }))
  }

  /** The digest ingest will compute for a file: the hash of its rendered display bytes. */
  const hashOf = (tag: string): string => hasher.sha256Hex(images.renderedBytes(tag, 'display'))

  const storedPhotos = async (eventId: EventId = EVENT): Promise<readonly Photo[]> =>
    (await photos.list(eventId)).items

  // -------------------------------------------------------------- the happy path --

  it('stores one row and three variants for a photo, and announces the upload', async () => {
    seedEvent()

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(outcomesOf(result)).toEqual([
      { index: 0, declaredName: 'sunset.jpg', kind: 'stored', photoId: 'photo-1' },
    ])
    const photo = only(await storedPhotos())
    expect(media.variantsOf(EVENT, photo.contentHash)).toEqual(['original', 'display', 'thumb'])
    expect(bus.published).toEqual([{ type: 'photo.uploaded', eventId: EVENT, photoId: 'photo-1' }])
  })

  it('reads the header before it decodes anything', async () => {
    seedEvent()

    await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(images.calls).toEqual([
      'probe:sunset',
      'render:sunset:display',
      'render:sunset:thumb',
      'render:sunset:original',
    ])
  })

  it('addresses stored media by event, so two events can never share a file', async () => {
    seedEvent()

    await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    const photo = only(await storedPhotos())
    expect(media.variantsOf(OTHER_EVENT, photo.contentHash)).toEqual([])
  })

  it('stores the dimensions of the display variant, not of the file the phone sent', async () => {
    seedEvent()

    await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(only(await storedPhotos()).dimensions.toString()).toBe('2560x1920')
  })

  // --------------------------------------------------------------- the event gate --

  it('refuses an upload to an event that does not exist', async () => {
    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(images.calls).toEqual([])
  })

  it('cannot upload to an event through another event id', async () => {
    seedEvent()

    const result = await uploadPhotos({
      eventId: OTHER_EVENT,
      author: GUEST,
      files: [aFile('sunset')],
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(media.objectCount).toBe(0)
  })

  it.each(['draft', 'closed', 'archived'] as const)(
    'refuses an upload while the event is %s',
    async (status) => {
      seedEvent({ status })

      const result = await uploadPhotos({
        eventId: EVENT,
        author: GUEST,
        files: [aFile('sunset')],
      })

      expect(!result.ok && result.error.code).toBe('event.notAcceptingUploads')
      expect(images.calls).toEqual([])
    },
  )

  // ------------------------------------------------------------------ the caption --

  it('puts the caption of the request on every photo of the request', async () => {
    seedEvent()

    await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset'), aFile('cake')],
      caption: '  Les mariés  ',
    })

    const captions = (await storedPhotos()).map((photo) => photo.caption?.value)
    expect(captions).toEqual(['Les mariés', 'Les mariés'])
  })

  it('refuses a caption on an event that does not accept captions', async () => {
    seedEvent({ settings: { allowCaptions: false } })

    const result = await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset')],
      caption: 'Les mariés',
    })

    expect(!result.ok && result.error.code).toBe('event.captionsNotAllowed')
    expect(media.objectCount).toBe(0)
  })

  it('accepts a blank caption field on an event that does not accept captions', async () => {
    seedEvent({ settings: { allowCaptions: false } })

    const result = await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset')],
      caption: '   ',
    })

    expect(kinds(result)).toEqual(['stored'])
  })

  it('refuses a caption longer than the wall can display', async () => {
    seedEvent()

    const result = await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset')],
      caption: 'a'.repeat(141),
    })

    expect(!result.ok && result.error.code).toBe('caption.tooLong')
  })

  // --------------------------------------------------------- the per-guest limit --

  it('refuses the request when it would take the guest past their photo limit', async () => {
    seedEvent({ settings: { maxPhotosPerGuest: 2 } })
    photos.seed(
      aPhoto({ id: 'earlier', eventId: 'event-1', author: { kind: 'guest', id: 'guest-1' } }),
    )

    const result = await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset'), aFile('cake')],
    })

    expect(!result.ok && result.error.code).toBe('event.photoLimitReached')
  })

  it('refuses a request past the photo limit with a quota kind, so the endpoint answers 413', async () => {
    seedEvent({ settings: { maxPhotosPerGuest: 1 } })
    photos.seed(
      aPhoto({ id: 'earlier', eventId: 'event-1', author: { kind: 'guest', id: 'guest-1' } }),
    )

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(!result.ok && result.error.kind).toBe('quotaExceeded')
  })

  it('accepts a request that exactly reaches the guest photo limit', async () => {
    seedEvent({ settings: { maxPhotosPerGuest: 2 } })
    photos.seed(
      aPhoto({ id: 'earlier', eventId: 'event-1', author: { kind: 'guest', id: 'guest-1' } }),
    )

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(kinds(result)).toEqual(['stored'])
  })

  it('does not count another guest photos against this guest limit', async () => {
    seedEvent({ settings: { maxPhotosPerGuest: 1 } })
    photos.seed(
      aPhoto({ id: 'earlier', eventId: 'event-1', author: { kind: 'guest', id: 'guest-9' } }),
    )

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(kinds(result)).toEqual(['stored'])
  })

  it('does not apply the guest photo limit to the host camera roll', async () => {
    seedEvent({ settings: { maxPhotosPerGuest: 1 } })

    const result = await uploadPhotos({
      eventId: EVENT,
      author: HOST,
      files: [aFile('sunset'), aFile('cake')],
    })

    expect(kinds(result)).toEqual(['stored', 'stored'])
  })

  // ---------------------------------------------------------- probe before decode --

  it('refuses a file the pipeline does not recognise as an image', async () => {
    seedEvent()
    images.script('invoice', { probeError: DomainError.invalid('image.unsupportedFormat') })

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('invoice')] })

    expect(refusal(result).code).toBe('image.unsupportedFormat')
    expect(images.calls).toEqual(['probe:invoice'])
  })

  it('refuses a pixel bomb from its header, before anything is decoded', async () => {
    seedEvent()
    images.script('bomb', { width: 30_000, height: 30_000 })

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('bomb')] })

    expect(refusal(result).code).toBe('photo.pixelBudgetExceeded')
    expect(images.calls).toEqual(['probe:bomb'])
  })

  it('refuses a pixel bomb with a quota kind, so the endpoint answers 413', async () => {
    seedEvent()
    images.script('bomb', { width: 30_000, height: 30_000 })

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('bomb')] })

    expect(refusal(result).kind).toBe('quotaExceeded')
  })

  it.each(MEDIA_VARIANTS)(
    'refuses the file and writes nothing when the %s variant cannot be rendered',
    async (variant) => {
      seedEvent()
      images.script('corrupt', { renderErrorAt: variant })

      const result = await uploadPhotos({
        eventId: EVENT,
        author: GUEST,
        files: [aFile('corrupt')],
      })

      expect(refusal(result).code).toBe('image.renderFailed')
      expect(media.objectCount).toBe(0)
    },
  )

  // -------------------------------------------------------------- idempotency --

  it('reports a photo already in the event as a duplicate instead of storing it twice', async () => {
    seedEvent()
    photos.seed(aPhoto({ id: 'earlier', eventId: 'event-1', contentHash: hashOf('sunset') }))

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(outcomesOf(result)).toEqual([
      { index: 0, declaredName: 'sunset.jpg', kind: 'duplicate', photoId: 'earlier' },
    ])
    expect(await storedPhotos()).toHaveLength(1)
  })

  it('announces nothing for a duplicate, so a retry does not disturb the wall', async () => {
    seedEvent()
    photos.seed(aPhoto({ id: 'earlier', eventId: 'event-1', contentHash: hashOf('sunset') }))

    await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(bus.published).toEqual([])
  })

  it('stores one photo when a single request carries the same file twice', async () => {
    seedEvent()

    const result = await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset'), aFile('sunset')],
    })

    expect(kinds(result)).toEqual(['stored', 'duplicate'])
    expect(await storedPhotos()).toHaveLength(1)
  })

  it('judges a duplicate within the event only, so the same bytes may reach two events', async () => {
    seedEvent()
    photos.seed(aPhoto({ id: 'elsewhere', eventId: 'event-2', contentHash: hashOf('sunset') }))

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(kinds(result)).toEqual(['stored'])
    expect(await storedPhotos()).toHaveLength(1)
  })

  // -------------------------------------------------------------- the byte quota --

  it('refuses an upload once the event byte quota is reached', async () => {
    seedEvent({ quotaBytes: 1_000_000 })
    photos.seed(aPhoto({ id: 'earlier', eventId: 'event-1', byteSize: 1_000_000 }))

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(refusal(result).code).toBe('event.quotaExceeded')
    expect(refusal(result).kind).toBe('quotaExceeded')
  })

  it('counts the files of one request against each other, so a batch cannot overrun the quota', async () => {
    seedEvent({ quotaBytes: 2_500_000 })

    const result = await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset'), aFile('cake'), aFile('speech')],
    })

    expect(kinds(result)).toEqual(['stored', 'stored', 'refused'])
    expect(await storedPhotos()).toHaveLength(2)
  })

  it('charges every stored variant to the quota, because every variant is on the disk', async () => {
    seedEvent()

    await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(await photos.totalBytes(EVENT)).toBe(1_000_000)
  })

  // ------------------------------------------------- two uploads at the same time --

  /**
   * The race, run for real: two requests in flight against one event, not two requests
   * one after the other. Every port call is a promise, so both uploads read the event's
   * byte total before either of them writes a row — which is exactly the window that
   * made the quota beatable by a factor equal to the number of requests in flight.
   *
   * These are the tests that fail if the reservation moves back out of the write.
   */
  it('holds the byte quota when two guests upload at the same moment', async () => {
    // Room for one photo of 1 MB, and two guests each sending one.
    seedEvent({ quotaBytes: 1_500_000 })

    const [first, second] = await Promise.all([
      uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] }),
      uploadPhotos({ eventId: EVENT, author: OTHER_GUEST, files: [aFile('cake')] }),
    ])

    expect(await photos.totalBytes(EVENT)).toBe(1_000_000)
    expect([...kinds(first), ...kinds(second)].sort()).toEqual(['refused', 'stored'])
  })

  it('tells the guest whose photo lost the race that the quota is full', async () => {
    seedEvent({ quotaBytes: 1_500_000 })

    const results = await Promise.all([
      uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] }),
      uploadPhotos({ eventId: EVENT, author: OTHER_GUEST, files: [aFile('cake')] }),
    ])
    const loser = results.find((result) => kinds(result).includes('refused'))

    expect(loser === undefined ? null : refusal(loser).code).toBe('event.quotaExceeded')
  })

  it('keeps no media for a photo two concurrent uploads left no room for', async () => {
    seedEvent({ quotaBytes: 1_500_000 })

    await Promise.all([
      uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] }),
      uploadPhotos({ eventId: EVENT, author: OTHER_GUEST, files: [aFile('cake')] }),
    ])

    // Three variants for the one photo that landed, and nothing for the one that did
    // not: the quota protects a disk, so a refused photo must not sit on it.
    expect(media.objectCount).toBe(3)
  })

  it('holds the per-guest photo limit when one guest uploads twice at the same moment', async () => {
    seedEvent({ settings: { maxPhotosPerGuest: 1 } })

    await Promise.all([
      uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] }),
      uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('cake')] }),
    ])

    expect(await photos.countByAuthor(EVENT, asGuestId('guest-1'))).toBe(1)
  })

  // ------------------------------------------- refused by the write transaction --

  const QUOTA_REFUSAL: PhotoRefusal = { reason: 'quotaExceeded', remaining: 512 }
  const LIMIT_REFUSAL: PhotoRefusal = { reason: 'photoLimitReached', already: 4 }

  const uploadInto = (repository: FakePhotoRepository): UploadPhotos =>
    build({ photos: repository })

  it('refuses the file the write turned away, with the code the endpoint answers 413 to', async () => {
    seedEvent()
    const full = new FullPhotoRepository(QUOTA_REFUSAL)

    const result = await uploadInto(full)({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset')],
    })

    expect(refusal(result).code).toBe('event.quotaExceeded')
    expect(refusal(result).kind).toBe('quotaExceeded')
  })

  it('reports what the quota had left at the moment the write refused, not before', async () => {
    seedEvent()
    const full = new FullPhotoRepository(QUOTA_REFUSAL)

    const result = await uploadInto(full)({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset')],
    })

    expect(refusal(result).details).toEqual({ remaining: 512, required: 1_000_000 })
  })

  it('names the per-guest limit when that is what the write refused', async () => {
    seedEvent()
    const full = new FullPhotoRepository(LIMIT_REFUSAL)

    const result = await uploadInto(full)({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset')],
    })

    expect(refusal(result).code).toBe('event.photoLimitReached')
    expect(refusal(result).details).toEqual({ already: 4 })
  })

  it('removes the media of a photo the write turned away', async () => {
    seedEvent()
    const full = new FullPhotoRepository(QUOTA_REFUSAL)

    await uploadInto(full)({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(media.objectCount).toBe(0)
  })

  it('leaves the media alone when the row that won the race holds the same bytes', async () => {
    // Two guests sending the same photo in the same instant: media is addressed by
    // content, so the loser deleting "its" file would take the winner's slide with it.
    seedEvent()
    const lost = new LostRacePhotoRepository(hashOf('sunset'))

    await uploadInto(lost)({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(media.objectCount).toBe(3)
  })

  it('announces nothing for a photo the write turned away', async () => {
    seedEvent({ settings: { moderation: 'auto' } })
    const full = new FullPhotoRepository(QUOTA_REFUSAL)

    await uploadInto(full)({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(bus.published).toEqual([])
  })

  it('refuses the duplicate of a photo the write turned away, rather than naming a row that was never written', async () => {
    seedEvent()
    const full = new FullPhotoRepository(QUOTA_REFUSAL)

    const result = await uploadInto(full)({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset'), aFile('sunset')],
    })

    expect(kinds(result)).toEqual(['refused', 'refused'])
  })

  // --------------------------------------------------------------- moderation --

  it('leaves a photo pending on a manually moderated event', async () => {
    seedEvent({ settings: { moderation: 'manual' } })

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(result.ok && result.value.published).toEqual([])
    expect(only(await storedPhotos()).status).toBe('pending')
  })

  it('publishes on ingest with an automatic reviewer when the event moderates itself', async () => {
    seedEvent({ settings: { moderation: 'auto' } })

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(result.ok && result.value.published).toEqual(['photo-1'])
    const photo = only(await storedPhotos())
    expect(photo.status).toBe('published')
    expect(photo.review?.kind).toBe('automatic')
  })

  it('announces the automatic decision as well as the upload, so the wall learns of it', async () => {
    seedEvent({ settings: { moderation: 'auto' } })

    await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(bus.published).toEqual([
      { type: 'photo.uploaded', eventId: EVENT, photoId: 'photo-1' },
      { type: 'photo.moderated', eventId: EVENT, photoId: 'photo-1', status: 'published' },
    ])
  })

  // ------------------------------------------------------------ partial batches --

  it('stores the files it can and names the one it cannot', async () => {
    seedEvent()
    images.script('invoice', { probeError: DomainError.invalid('image.unsupportedFormat') })

    const result = await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset'), aFile('invoice'), aFile('cake')],
    })

    expect(outcomesOf(result).map((outcome) => outcome.declaredName)).toEqual([
      'sunset.jpg',
      'invoice.jpg',
      'cake.jpg',
    ])
    expect(kinds(result)).toEqual(['stored', 'refused', 'stored'])
  })

  it('writes no row and announces nothing when every file of the request is refused', async () => {
    seedEvent()
    images.script('invoice', { probeError: DomainError.invalid('image.unsupportedFormat') })

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('invoice')] })

    expect(kinds(result)).toEqual(['refused'])
    expect(await storedPhotos()).toEqual([])
    expect(bus.published).toEqual([])
  })

  // ------------------------------------------------------------------ unwinding --

  it('removes the media this request wrote when a variant cannot be stored', async () => {
    seedEvent()
    // Four writes land: the first file entire, then one variant of the second.
    media.failAfter(4)

    const result = await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset'), aFile('cake')],
    })

    expect(!result.ok && result.error.code).toBe('photo.mediaWriteFailed')
    expect(media.objectCount).toBe(0)
  })

  it('inserts no row when a media write fails, so no row can point at a missing file', async () => {
    seedEvent()
    media.failAfter(0)

    await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(await storedPhotos()).toEqual([])
  })

  it('leaves media written by an earlier upload alone while unwinding this one', async () => {
    seedEvent()
    const earlier = aPhoto({ id: 'earlier', eventId: 'event-1' })
    photos.seed(earlier)
    await media.put(EVENT, earlier.contentHash, 'display', tagBytes('earlier'))
    media.failAfter(1)

    await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(media.variantsOf(EVENT, earlier.contentHash)).toEqual(['display'])
  })

  it('removes the media it wrote when the rows cannot be inserted', async () => {
    seedEvent()
    const locked = new LockedPhotoRepository()
    const upload = build({ photos: locked })

    const result = await upload({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(!result.ok && result.error.code).toBe('photo.saveFailed')
    expect(media.objectCount).toBe(0)
  })

  it('refuses the whole request and unwinds when a rendered variant has no bytes at all', async () => {
    seedEvent()
    images.script('empty', { byteSizes: { original: 0, display: 0, thumb: 0 } })

    const result = await uploadPhotos({
      eventId: EVENT,
      author: GUEST,
      files: [aFile('sunset'), aFile('empty')],
    })

    expect(!result.ok && result.error.code).toBe('photo.byteSizeInvalid')
    expect(media.objectCount).toBe(0)
    expect(await storedPhotos()).toEqual([])
  })

  it('stops the request and unwinds when the hasher does not return a digest', async () => {
    seedEvent()
    hasher.returnGarbage()

    const result = await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(!result.ok && result.error.code).toBe('photo.hashFailed')
    expect(!result.ok && result.error.kind).toBe('unexpected')
    expect(media.objectCount).toBe(0)
  })

  it('logs the cause when it unwinds, so an operator can tell a full disk from a bug', async () => {
    seedEvent()
    media.failAfter(0)

    await uploadPhotos({ eventId: EVENT, author: GUEST, files: [aFile('sunset')] })

    expect(logger.lines.map((line) => line.level)).toEqual(['error'])
  })
})
