import type { Event } from '../../../domain/events/event'
import { hasPhotographedGround } from '../../../domain/events/eventTheme'
import { ContentHash } from '../../../domain/photos/contentHash'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ContentHasher } from '../../ports/contentHasher'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { ImageProcessor, RenderSpec } from '../../ports/imageProcessor'
import type { Logger } from '../../ports/logger'
import { VENUE_GROUND, type MediaStore } from '../../ports/mediaStore'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * The host replaces an ambiance's bundled ground with a photograph of their own venue
 * (docs/adr/0010-event-ambiances.md, decision 8).
 *
 * Owner only, for `updateEventSettings`' reason: it is a change to how the evening looks.
 * It serves the guest's phone and the room first, and the host second.
 *
 * ## The pipeline, in the order that matters
 *
 * 1. the role, then the event's state, in that order, so a refusal that names the state
 *    never confirms an event exists to somebody with no part in it;
 * 2. **the ambiance must photograph its ground** (`hasPhotographedGround`), or the upload would
 *    be stored and shown nowhere;
 * 3. `probe` from the header before any decode, and the pixel budget on the declared numbers:
 *    the only order that stops a decompression bomb, exactly as `uploadPhotos` does it. The
 *    format is identified from the bytes by the adapter; the client's MIME type and filename
 *    never reach this function;
 * 4. `render`: rotated upright, **every metadata block stripped** (a venue photograph carries
 *    the GPS coordinates of the venue, which is the one thing a guest-facing file must not
 *    hand out), downscaled and re-encoded, so a polyglot cannot survive;
 * 5. bytes first, row second (CLAUDE.md section 9, trap 4): a failed save removes what this
 *    request wrote and **only what the previous settings do not name**, and a failed removal of
 *    the previous file is the sweep's to finish, never a reason to fail a save that succeeded.
 *
 * ## Why it is not counted against the byte quota
 *
 * The quota is a ceiling on the guests' photographs, enforced by a transaction over the
 * `photos` rows; a decoration that could exhaust it would refuse a guest's photograph on the
 * host's own account. The omission is bounded instead: one file per event, replaced in place,
 * never larger than {@link MAX_VENUE_PHOTO_BYTES}. docs/SECURITY.md says so.
 */

/**
 * What the ground is rendered to: 1600 px on the long side, the width of the photograph the
 * product ships, at a quality that is plenty for a picture shown under a dark grade and
 * `cover`-cropped to a phone. WebP, because the bundled ground is one and it is the smallest
 * format every supported browser reads.
 */
export const VENUE_GROUND_SPEC: RenderSpec = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 60,
  format: 'webp',
}

/**
 * The most a rendered ground may weigh. A 1600 px WebP at quality 60 is a few hundred
 * kilobytes even for a noisy night photograph, so this is a backstop that keeps the figure
 * in docs/SECURITY.md true rather than a limit a host meets.
 */
export const MAX_VENUE_PHOTO_BYTES = 1_048_576

export interface SetVenuePhotoInput {
  readonly eventId: EventId
  readonly actorId: UserId
  /** The file as it arrived. Untrusted until `probe` has read its header. */
  readonly bytes: Uint8Array
}

export interface SetVenuePhotoDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly media: MediaStore
  readonly imageProcessor: ImageProcessor
  readonly hasher: ContentHasher
  readonly bus: EventBus
  readonly logger: Logger
  /** `width * height` a header may declare before the file is refused undecoded. */
  readonly limits: { readonly maxPixels: number }
}

export type SetVenuePhoto = (input: SetVenuePhotoInput) => Promise<Result<Event, DomainError>>

export const makeSetVenuePhoto = ({
  events,
  memberships,
  media,
  imageProcessor,
  hasher,
  bus,
  logger,
  limits,
}: SetVenuePhotoDeps): SetVenuePhoto => {
  const discard = async (eventId: EventId, hash: ContentHash): Promise<void> => {
    try {
      await media.delete(eventId, hash)
    } catch (cause) {
      logger.warn('could not remove a venue photo; leaving it for the sweep', {
        eventId,
        cause: String(cause),
      })
    }
  }

  return async ({ eventId, actorId, bytes }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    if (!hasPhotographedGround(event.settings.theme.ambiance)) {
      return err(
        DomainError.conflict('venuePhoto.ambianceHasNoPhotograph', {
          ambiance: event.settings.theme.ambiance,
        }),
      )
    }

    const probed = await imageProcessor.probe(bytes)
    if (!probed.ok) return probed
    if (probed.value.dimensions.exceedsPixelBudget(limits.maxPixels)) {
      return err(
        DomainError.quotaExceeded('photo.pixelBudgetExceeded', {
          maxPixels: limits.maxPixels,
          pixels: probed.value.dimensions.pixels,
        }),
      )
    }

    const rendered = await imageProcessor.render(bytes, VENUE_GROUND_SPEC)
    if (!rendered.ok) return rendered
    if (rendered.value.byteSize > MAX_VENUE_PHOTO_BYTES) {
      return err(DomainError.quotaExceeded('venuePhoto.tooLarge', { max: MAX_VENUE_PHOTO_BYTES }))
    }

    // The digest of what is stored, so the same photograph sent twice is one file, and so the
    // name changes when the bytes do: which is what makes the route's year-long cache safe.
    const digest = ContentHash.create(hasher.sha256Hex(rendered.value.bytes))
    if (!digest.ok) {
      logger.error('content hasher returned something that is not a sha-256 digest', {
        eventId,
        code: digest.error.code,
      })
      return err(DomainError.unexpected('photo.hashFailed'))
    }

    const previous = event.settings.venuePhoto

    // Written before the row names it. If this throws, nothing names the file, and the sweep
    // collects whatever landed.
    try {
      await media.put(eventId, digest.value, VENUE_GROUND, rendered.value.bytes)
    } catch (cause) {
      logger.error('media write failed for a venue photo', { eventId, cause: String(cause) })
      return err(DomainError.unexpected('photo.mediaWriteFailed'))
    }

    // Neither of these can refuse: the patch touches no field a settings merge judges, and a
    // writable event has just been read. They are returned rather than asserted so that a
    // broken invariant surfaces as an error and not as a crash.
    const settings = event.settings.with({ venuePhoto: digest.value })
    if (!settings.ok) return settings
    const updated = event.withSettings(settings.value)
    if (!updated.ok) return updated

    const replacesItself = previous !== null && previous.equals(digest.value)

    try {
      await events.save(updated.value)
    } catch (cause) {
      logger.error('could not save the event after writing its venue photo', {
        eventId,
        cause: String(cause),
      })
      // The new file only if the settings still stored do not name it: the same photograph
      // uploaded again is the file the event is already showing.
      if (!replacesItself) await discard(eventId, digest.value)
      return err(DomainError.unexpected('venuePhoto.saveFailed'))
    }

    bus.publish({ type: 'event.settingsChanged', eventId })

    // The previous photograph, now named by nothing. Best effort and after the save: a file
    // left behind is the sweep's to collect, and a throw here would report a failure for a
    // photograph that is on the wall.
    if (previous !== null && !replacesItself) await discard(eventId, previous)

    return ok(updated.value)
  }
}
