import { Caption } from '../../../domain/photos/caption'
import { ContentHash } from '../../../domain/photos/contentHash'
import { Dimensions } from '../../../domain/photos/dimensions'
import { Photo, type PhotoAuthor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { ContentHasher } from '../../ports/contentHasher'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { ImageProcessor, RenderSpec, RenderedImage } from '../../ports/imageProcessor'
import type { Logger } from '../../ports/logger'
import { MEDIA_VARIANTS, type MediaStore, type MediaVariant } from '../../ports/mediaStore'
import type {
  PhotoAdmission,
  PhotoRefusal,
  PhotoRepository,
} from '../../ports/photoRepository'

/**
 * Guest photo ingest: the request this product exists for, and the one place where a
 * hostile file, a dropped connection, a full disk and a byte quota all meet.
 *
 * The order of the pipeline is the design. Every step is placed where it is because
 * doing it later cost 1.0 something real:
 *
 * 1. the event gate, so a public endpoint cannot write to an event that is not open;
 * 2. `probe` before any decode, so a decompression bomb is refused from its header;
 * 3. hash the **rendered** bytes, so a retry is recognised as a retry;
 * 4. media written before the row, so a `sharp` failure can never leave a row
 *    pointing at a file that does not exist;
 * 5. the limits re-checked inside the write transaction, because a total read here can
 *    be stale by the time the batch is inserted — that is what makes the quota hold
 *    when two guests upload at the same moment, and not merely when they take turns;
 * 6. every exit path after a write removes what this request wrote.
 *
 * A batch is a partial success, not all-or-nothing: a guest who selected five photos
 * and one PDF gets five photos and one named refusal. Handing back a single opaque
 * error for the batch is how 1.0 left a guest re-picking six files on venue Wi-Fi.
 */

/** One file as it arrived. `declaredName` is metadata echoed back, never a path. */
export interface UploadFile {
  readonly bytes: Uint8Array
  readonly declaredName: string
}

export interface UploadPhotosInput {
  readonly eventId: EventId
  readonly author: PhotoAuthor
  readonly files: readonly UploadFile[]
  /** One caption for the request, as the upload form offers it. */
  readonly caption?: string | null
}

/** Header-level ceilings the deployment sets; the render specs below are product policy. */
export interface UploadLimits {
  /** `width * height` a header may declare before the file is refused undecoded. */
  readonly maxPixels: number
}

export interface UploadPhotosDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly imageProcessor: ImageProcessor
  readonly hasher: ContentHasher
  readonly bus: EventBus
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly logger: Logger
  readonly limits: UploadLimits
}

export interface UploadOutcomeBase {
  /** Position in the request, so a client can match an outcome to its queue row. */
  readonly index: number
  readonly declaredName: string
}

export type UploadOutcome =
  | (UploadOutcomeBase & { readonly kind: 'stored'; readonly photoId: PhotoId })
  | (UploadOutcomeBase & { readonly kind: 'duplicate'; readonly photoId: PhotoId })
  | (UploadOutcomeBase & { readonly kind: 'refused'; readonly error: DomainError })

export interface UploadPhotosResult {
  /** One entry per submitted file, in the order they were submitted. */
  readonly outcomes: readonly UploadOutcome[]
  /** Ids published on ingest, so a guest on an auto-publish event is told it is live. */
  readonly published: readonly PhotoId[]
}

export type UploadPhotos = (
  input: UploadPhotosInput,
) => Promise<Result<UploadPhotosResult, DomainError>>

/**
 * What each stored variant is rendered to. The longest edges come from the `MediaStore`
 * port's table: 2560 px serves a 4K projector, 480 px serves a moderation grid.
 *
 * `original` goes through `render` as well rather than being copied through. The stored
 * bytes are always the pipeline's output — rotated upright, stripped of EXIF, and
 * re-encoded — so a polyglot file that is a valid JPEG *and* something else cannot
 * survive ingest, and a host's album never carries the GPS coordinates of a guest's
 * home. Its box is the domain's maximum edge, so it re-encodes without downscaling.
 */
export const VARIANT_SPECS: Readonly<Record<MediaVariant, RenderSpec>> = {
  original: {
    maxWidth: Dimensions.maxEdge,
    maxHeight: Dimensions.maxEdge,
    quality: 92,
    format: 'jpeg',
  },
  display: { maxWidth: 2560, maxHeight: 2560, quality: 82, format: 'jpeg' },
  thumb: { maxWidth: 480, maxHeight: 480, quality: 72, format: 'jpeg' },
}

type RenderedVariants = Readonly<Record<MediaVariant, RenderedImage>>

/**
 * All three variants, or the first reason none of them can be stored.
 *
 * Rendering every variant before a single byte is written is what makes the cleanup in
 * the caller bounded: a failure here has touched nothing.
 */
const renderVariants = async (
  imageProcessor: ImageProcessor,
  bytes: Uint8Array,
): Promise<Result<RenderedVariants, DomainError>> => {
  const display = await imageProcessor.render(bytes, VARIANT_SPECS.display)
  if (!display.ok) return display

  const thumb = await imageProcessor.render(bytes, VARIANT_SPECS.thumb)
  if (!thumb.ok) return thumb

  const original = await imageProcessor.render(bytes, VARIANT_SPECS.original)
  if (!original.ok) return original

  return ok({ display: display.value, thumb: thumb.value, original: original.value })
}

/**
 * The refusal a guest is shown for a photo the write transaction turned away.
 *
 * Same codes as the checks before the loop, because it is the same rule — only decided
 * against the state that was actually committed rather than the one this request read
 * before it started rendering.
 */
const refusalError = (refusal: PhotoRefusal, requiredBytes: number): DomainError =>
  refusal.reason === 'quotaExceeded'
    ? DomainError.quotaExceeded('event.quotaExceeded', {
        remaining: refusal.remaining,
        required: requiredBytes,
      })
    : DomainError.quotaExceeded('event.photoLimitReached', { already: refusal.already })

/**
 * Restates the outcomes of the photos the write transaction turned away.
 *
 * A `duplicate` outcome is restated too, not only a `stored` one: it names a photo
 * earlier in this same request, and if that photo was never written there is nothing
 * left for it to point at.
 */
const settle = (
  outcomes: readonly UploadOutcome[],
  turnedAway: ReadonlyMap<PhotoId, DomainError>,
): readonly UploadOutcome[] =>
  outcomes.map((outcome) => {
    if (outcome.kind === 'refused') return outcome

    const error = turnedAway.get(outcome.photoId)
    if (error === undefined) return outcome
    return { index: outcome.index, declaredName: outcome.declaredName, kind: 'refused', error }
  })

export const makeUploadPhotos = ({
  events,
  photos,
  media,
  imageProcessor,
  hasher,
  bus,
  clock,
  ids,
  logger,
  limits,
}: UploadPhotosDeps): UploadPhotos => {
  return async ({ eventId, author, files, caption }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // The single gate that makes a public upload endpoint safe. 1.0 accepted any
    // `partyname` and created a directory for it, so anyone who found the URL could
    // write to the disk forever.
    if (!event.acceptsUploads()) {
      return err(DomainError.conflict('event.notAcceptingUploads', { status: event.status }))
    }

    const settings = event.settings

    // Parsed before the policy check so that "blank means no caption" is decided in one
    // place — an untouched form field must not trip a captions-off event.
    const parsedCaption = Caption.createOptional(caption)
    if (!parsedCaption.ok) return parsedCaption
    if (parsedCaption.value !== null && !settings.allowCaptions) {
      return err(DomainError.forbidden('event.captionsNotAllowed'))
    }

    const maxPerGuest = settings.maxPhotosPerGuest
    // A cap is a fairness tool between guests, so it does not apply to the host's own
    // camera roll. Storage is the byte quota's job, and that is checked per file below.
    //
    // Refusing the whole request here, before anything is decoded, is what keeps a guest
    // who is already at their limit from costing the box a single decode. It is not the
    // enforcing check: the repository takes this count again inside the write
    // transaction, where a second request of theirs cannot slip past it.
    if (maxPerGuest !== null && author.kind === 'guest') {
      const already = await photos.countByAuthor(eventId, author.guestId)
      if (already + files.length > maxPerGuest) {
        return err(
          DomainError.quotaExceeded('event.photoLimitReached', {
            max: maxPerGuest,
            already,
          }),
        )
      }
    }

    const now = clock.now()
    const usedBytes = await photos.totalBytes(eventId)

    const outcomes: UploadOutcome[] = []
    const created: Photo[] = []
    /** Hashes this request put into the store, so a failure removes exactly them. */
    const written: ContentHash[] = []
    /** Hashes seen earlier in this same request, keyed by hex — a batch can duplicate. */
    const seen = new Map<string, PhotoId>()
    let addedBytes = 0

    const unwind = async (): Promise<void> => {
      for (const hash of written) await media.delete(eventId, hash)
    }

    for (const [index, file] of files.entries()) {
      const at = { index, declaredName: file.declaredName }

      // Header first, always. The pixel budget is the decompression-bomb control, and
      // it is only a control if it is decided before anything is decoded.
      const probed = await imageProcessor.probe(file.bytes)
      if (!probed.ok) {
        outcomes.push({ ...at, kind: 'refused', error: probed.error })
        continue
      }
      if (probed.value.dimensions.exceedsPixelBudget(limits.maxPixels)) {
        outcomes.push({
          ...at,
          kind: 'refused',
          error: DomainError.quotaExceeded('photo.pixelBudgetExceeded', {
            maxPixels: limits.maxPixels,
            pixels: probed.value.dimensions.pixels,
          }),
        })
        continue
      }

      const rendered = await renderVariants(imageProcessor, file.bytes)
      if (!rendered.ok) {
        outcomes.push({ ...at, kind: 'refused', error: rendered.error })
        continue
      }

      const digest = ContentHash.create(hasher.sha256Hex(rendered.value.display.bytes))
      if (!digest.ok) {
        // A hasher that does not return a digest is a broken adapter, not a bad photo:
        // the next file would fail the same way, so the request stops here.
        logger.error('content hasher returned something that is not a sha-256 digest', {
          eventId,
          code: digest.error.code,
        })
        await unwind()
        return err(DomainError.unexpected('photo.hashFailed'))
      }

      const twin = seen.get(digest.value.value)
      if (twin !== undefined) {
        outcomes.push({ ...at, kind: 'duplicate', photoId: twin })
        continue
      }

      const existing = await photos.findByContentHash(eventId, digest.value)
      if (existing !== null) {
        // A double-tapped "Envoyer", or a retry after the connection dropped mid-upload.
        // 1.0 answered it with a second identical slide on the wall.
        outcomes.push({ ...at, kind: 'duplicate', photoId: existing.id })
        continue
      }

      // Every variant counts against the quota, because every variant is on the disk the
      // quota exists to protect — and it is what `MediaStore.usedBytes` reconciles with.
      const byteSize =
        rendered.value.original.byteSize +
        rendered.value.display.byteSize +
        rendered.value.thumb.byteSize

      // `addedBytes` accumulates, so ten files that each fit individually cannot
      // collectively overrun the quota.
      //
      // This is the cheap check, not the enforcing one: `usedBytes` was read before the
      // first decode and another request can commit against the same event while this
      // one renders. Its job is to stop a full event from decoding and writing three
      // variants per file only to have them removed again — which is the path a scanner
      // that found the endpoint would hammer. The repository decides for real.
      if (!event.hasQuotaFor(addedBytes + byteSize, usedBytes)) {
        outcomes.push({
          ...at,
          kind: 'refused',
          error: DomainError.quotaExceeded('event.quotaExceeded', {
            remaining: event.remainingQuota(usedBytes + addedBytes),
            required: byteSize,
          }),
        })
        continue
      }

      const photo = Photo.create(
        {
          eventId,
          author,
          contentHash: digest.value,
          // The display variant's dimensions: what the wall lays out is what it serves.
          dimensions: rendered.value.display.dimensions,
          byteSize,
          caption: parsedCaption.value,
        },
        ids.photoId(),
        now,
      )
      if (!photo.ok) {
        await unwind()
        return photo
      }

      // Recorded before the write, so a failure part-way through the variants still
      // removes the ones that landed — `delete` covers every variant and is idempotent.
      written.push(digest.value)
      try {
        for (const variant of MEDIA_VARIANTS) {
          await media.put(eventId, digest.value, variant, rendered.value[variant].bytes)
        }
      } catch (cause) {
        logger.error('media write failed during ingest; removing what this upload wrote', {
          eventId,
          cause: String(cause),
        })
        await unwind()
        return err(DomainError.unexpected('photo.mediaWriteFailed'))
      }

      seen.set(digest.value.value, photo.value.id)
      created.push(photo.value)
      addedBytes += byteSize
      outcomes.push({ ...at, kind: 'stored', photoId: photo.value.id })
    }

    // Media first, row second, and the rows in one transaction. 1.0 inserted first and
    // fired one insert per file, so a failure left rows pointing at nothing and a guest
    // with no way to tell which of their photos had landed.
    //
    // The limits travel with the batch because this is where they are *enforced*. The
    // checks above read totals that another request in flight can invalidate before this
    // one commits; the repository takes them again inside the write transaction, where
    // nothing can interleave, and refuses what no longer fits. So a photo can still be
    // turned away here, after its media has been written — which is why the unwinding
    // below is per photo rather than per request.
    let admissions: readonly PhotoAdmission[] = []
    if (created.length > 0) {
      try {
        admissions = await photos.saveManyWithinLimits(eventId, created, {
          quotaBytes: event.quotaBytes,
          maxPhotosPerGuest: maxPerGuest,
        })
      } catch (cause) {
        logger.error('photo insert failed; removing the media this upload wrote', {
          eventId,
          cause: String(cause),
        })
        await unwind()
        return err(DomainError.unexpected('photo.saveFailed'))
      }
    }

    const refusals = new Map<PhotoId, PhotoRefusal>()
    for (const admission of admissions) {
      if (admission.refusal !== null) refusals.set(admission.photoId, admission.refusal)
    }

    const turnedAway = new Map<PhotoId, DomainError>()
    const admitted: Photo[] = []
    for (const photo of created) {
      const refusal = refusals.get(photo.id)
      if (refusal === undefined) {
        admitted.push(photo)
        continue
      }
      turnedAway.set(photo.id, refusalError(refusal, photo.byteSize))

      // Its row was never written, so its media must not stay on the disk that the
      // quota exists to protect. Media is addressed by content, though, and the request
      // that beat this one to the quota may have been a byte-identical photo from
      // another guest — whose row now holds this hash. Deleting then would leave *their*
      // slide pointing at nothing, so the file goes only if nothing points at it.
      if ((await photos.findByContentHash(eventId, photo.contentHash)) === null) {
        await media.delete(eventId, photo.contentHash)
      }
    }

    // An auto-publish event records an `automatic` reviewer immediately, so the wall
    // never shows a photo whose decision nobody can account for afterwards. Going
    // through the bulk update means the announcement below names exactly the rows that
    // actually moved.
    const published =
      settings.moderation === 'auto'
        ? await photos.updateStatuses(
            eventId,
            admitted.map((photo) => photo.id),
            'published',
            { kind: 'automatic', at: now },
          )
        : []

    for (const photo of admitted) {
      bus.publish({ type: 'photo.uploaded', eventId, photoId: photo.id })
    }
    for (const photoId of published) {
      bus.publish({ type: 'photo.moderated', eventId, photoId, status: 'published' })
    }

    return ok({ outcomes: settle(outcomes, turnedAway), published })
  }
}
