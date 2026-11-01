import type { Event } from '../../../domain/events/event'
import { ContentHash } from '../../../domain/photos/contentHash'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ContentHasher } from '../../ports/contentHasher'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { ImageProcessor, RenderSpec } from '../../ports/imageProcessor'
import type { Logger } from '../../ports/logger'
import { EVENT_LOGO, type MediaStore } from '../../ports/mediaStore'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * The host sends their event's logo (spec 03): a small image shown on the guest's join page and
 * on the empty wall. Owner only, for `updateEventSettings`' reason.
 *
 * The pipeline is `setVenuePhoto`'s, in the same order and for the same reasons:
 *
 * 1. the role, then the state, then a purge hold (a held event keeps every file it has);
 * 2. `probe` from the header and the pixel budget **before any decode**: the budget, not the
 *    upload ceiling, is what bounds the CPU and memory a small PNG can cost on a 4 GB box;
 * 3. `render`: rotated upright, every metadata block stripped (a logo made on a phone can carry
 *    a GPS position), shrunk to fit and re-encoded to WebP with its transparency kept. The
 *    format is identified from the bytes by the adapter, so an SVG, which is code and never an
 *    image the pipeline identifies, is refused as `image.unsupportedFormat`;
 * 4. bytes first, row second (CLAUDE.md section 9, trap 4), and the event **read again with no
 *    await between that read and the save**, so that a settings save in flight cannot be undone.
 *
 * The stored name is the digest of the rendered bytes, under the {@link EVENT_LOGO} variant:
 * `media.delete(eventId, hash)` removes that digest under every variant, and no other variant
 * holds this rendering, so a logo and a venue photograph never share a file.
 *
 * Not counted against the byte quota, for the venue photograph's argument: a decoration must
 * not refuse a guest's photograph. It is bounded instead, at {@link MAX_LOGO_BYTES} per event.
 */

/** Small, and transparent where the source is. `fit: inside` without enlarging is the adapter's rule. */
export const LOGO_SPEC: RenderSpec = {
  maxWidth: 640,
  maxHeight: 320,
  quality: 85,
  format: 'webp',
}

/**
 * The formats a logo may be sent in (Pierre, 01/11/2026): PNG, JPEG and WebP. The pipeline would also
 * read AVIF, HEIF and a still GIF for a photograph; none of them is a logo format a host has, and a
 * narrower door is a narrower parser surface. SVG is code and is never identified at all.
 */
const LOGO_FORMATS: readonly string[] = ['png', 'jpeg', 'webp']

/** The most a rendered logo may weigh (256 KiB), after the render. docs/SECURITY.md states the figure. */
export const MAX_LOGO_BYTES = 262_144

export interface SetEventLogoInput {
  readonly eventId: EventId
  readonly actorId: UserId
  /** The file as it arrived. Untrusted until `probe` has read its header. */
  readonly bytes: Uint8Array
}

export interface SetEventLogoDeps {
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

export type SetEventLogo = (input: SetEventLogoInput) => Promise<Result<Event, DomainError>>

export const makeSetEventLogo = ({
  events,
  memberships,
  media,
  imageProcessor,
  hasher,
  bus,
  logger,
  limits,
}: SetEventLogoDeps): SetEventLogo => {
  const discard = async (eventId: EventId, hash: ContentHash): Promise<void> => {
    try {
      await media.delete(eventId, hash)
    } catch (cause) {
      logger.warn('could not remove a logo; leaving it for the sweep', {
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

    // A held event keeps every file it has, the logo's included. Answered with a failure the
    // host can already get, never a code that exists only under a hold.
    if (event.isPurgeHeld()) return err(DomainError.unexpected('logo.saveFailed'))

    const probed = await imageProcessor.probe(bytes)
    if (!probed.ok) return probed
    if (!LOGO_FORMATS.includes(probed.value.format)) {
      return err(DomainError.invalid('image.unsupportedFormat'))
    }
    if (probed.value.dimensions.exceedsPixelBudget(limits.maxPixels)) {
      return err(
        DomainError.quotaExceeded('photo.pixelBudgetExceeded', {
          maxPixels: limits.maxPixels,
          pixels: probed.value.dimensions.pixels,
        }),
      )
    }

    const rendered = await imageProcessor.render(bytes, LOGO_SPEC)
    if (!rendered.ok) return rendered
    if (rendered.value.byteSize > MAX_LOGO_BYTES) {
      return err(DomainError.quotaExceeded('logo.tooLarge', { max: MAX_LOGO_BYTES }))
    }

    const digest = ContentHash.create(hasher.sha256Hex(rendered.value.bytes))
    if (!digest.ok) {
      logger.error('content hasher returned something that is not a sha-256 digest', {
        eventId,
        code: digest.error.code,
      })
      return err(DomainError.unexpected('photo.hashFailed'))
    }

    try {
      await media.put(eventId, digest.value, EVENT_LOGO, rendered.value.bytes)
    } catch (cause) {
      logger.error('media write failed for a logo', { eventId, cause: String(cause) })
      return err(DomainError.unexpected('photo.mediaWriteFailed'))
    }

    // **Read again, here, and saved with no await between.** The entity read at the top is a
    // decode and a re-encode old, and `events.save` rewrites the whole row.
    const current = await events.findById(eventId)
    if (current === null) {
      await discard(eventId, digest.value)
      return err(DomainError.notFound('event.notFound'))
    }
    const previous = current.settings.logo
    const replacesItself = previous !== null && previous.equals(digest.value)

    const updated = current.withSettings(current.settings.withLogo(digest.value))
    if (!updated.ok) {
      if (!replacesItself) await discard(eventId, digest.value)
      return updated
    }

    try {
      await events.save(updated.value)
    } catch (cause) {
      logger.error('could not save the event after writing its logo', {
        eventId,
        cause: String(cause),
      })
      if (!replacesItself) await discard(eventId, digest.value)
      return err(DomainError.unexpected('logo.saveFailed'))
    }

    bus.publish({ type: 'event.settingsChanged', eventId })

    // The previous logo, now named by nothing: best effort and after the save.
    if (previous !== null && !replacesItself) await discard(eventId, previous)

    return ok(updated.value)
  }
}
