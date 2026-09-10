import type { Event } from '../../../domain/events/event'
import type { EventRole } from '../../../domain/events/eventRole'
import type { EventSettings } from '../../../domain/events/eventSettings'
import type { Guest } from '../../../domain/guests/guest'
import type { Photo } from '../../../domain/photos/photo'
import type { User } from '../../../domain/users/user'
import type { EventSummary } from '../../../application/ports/eventRepository'
import type { MediaVariant } from '../../../application/ports/mediaStore'
import type {
  EventDto,
  EventSettingsDto,
  EventSummaryDto,
  GuestDto,
  GuestPhotoDto,
  ModerationPhotoDto,
  PublicEventDto,
  SessionUserDto,
} from './dto'

/**
 * Entity to wire format.
 *
 * Every function here is pure and takes exactly what it needs, so a presenter can be
 * tested without a request. The URL builders take the slug rather than reading a
 * global, which is what keeps the QR code, the printed card and the media links from
 * drifting apart.
 */

export interface PresenterContext {
  /** From PUBLIC_URL. The address a guest's phone can actually reach. */
  readonly publicUrl: string
  readonly uploadLimits: {
    readonly maxBytes: number
    readonly maxFiles: number
  }
}

const iso = (date: Date): string => date.toISOString()
const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

export const mediaUrl = (slug: string, photoId: string, variant: MediaVariant): string =>
  `/api/events/${encodeURIComponent(slug)}/photos/${encodeURIComponent(photoId)}/${variant}`

/**
 * The link behind the QR code.
 *
 * A path, not a query parameter. 1.0 put the event name in `?partyname=` on the QR
 * page and read `?party` on the upload page, so every guest silently uploaded to the
 * default event — the product's central feature was broken by a five-character
 * mismatch that nothing could catch.
 */
export const joinUrl = (publicUrl: string, joinCode: string): string =>
  `${publicUrl}/join/${encodeURIComponent(joinCode)}`

export const toEventSettingsDto = (settings: EventSettings): EventSettingsDto => ({
  moderation: settings.moderation,
  allowCaptions: settings.allowCaptions,
  allowReactions: settings.allowReactions,
  allowGuestSelfDelete: settings.allowGuestSelfDelete,
  guestSelfDeleteGraceSeconds: settings.guestSelfDeleteGraceSeconds,
  retentionDays: settings.retentionDays,
  maxPhotosPerGuest: settings.maxPhotosPerGuest,
})

/**
 * What a guest is told about the event.
 *
 * Compare with {@link toEventDto}: no owner, no quota, no counts, no join code, no
 * retention, no per-guest limit. A guest holding the join code learns the event's name
 * and whether captions and reactions are on, and nothing else.
 */
export const toPublicEventDto = (event: Event, context: PresenterContext): PublicEventDto => ({
  slug: event.slug.value,
  name: event.name.value,
  allowCaptions: event.settings.allowCaptions,
  allowReactions: event.settings.allowReactions,
  maxUploadBytes: context.uploadLimits.maxBytes,
  maxFilesPerUpload: context.uploadLimits.maxFiles,
})

export const toEventSummaryDto = (summary: EventSummary): EventSummaryDto => ({
  id: summary.id,
  slug: summary.slug,
  name: summary.name,
  status: summary.status,
  photoCount: summary.photoCount,
  pendingCount: summary.pendingCount,
  guestCount: summary.guestCount,
  usedBytes: summary.usedBytes,
  createdAt: iso(summary.createdAt),
})

export interface EventDtoInput {
  readonly event: Event
  readonly role: EventRole
  readonly counts: {
    readonly photoCount: number
    readonly pendingCount: number
    readonly guestCount: number
    readonly usedBytes: number
  }
}

export const toEventDto = (
  { event, role, counts }: EventDtoInput,
  context: PresenterContext,
): EventDto => ({
  id: event.id,
  slug: event.slug.value,
  name: event.name.value,
  status: event.status,
  photoCount: counts.photoCount,
  pendingCount: counts.pendingCount,
  guestCount: counts.guestCount,
  usedBytes: counts.usedBytes,
  createdAt: iso(event.createdAt),
  joinCode: event.joinCode.value,
  joinUrl: joinUrl(context.publicUrl, event.joinCode.value),
  quotaBytes: event.quotaBytes,
  settings: toEventSettingsDto(event.settings),
  startsAt: isoOrNull(event.startsAt),
  closedAt: isoOrNull(event.closedAt),
  role,
})

export interface GuestPhotoDtoInput {
  readonly photo: Photo
  readonly slug: string
  /** The result of `Photo.canBeDeletedBy` — decided by the domain, not re-derived here. */
  readonly canDelete: boolean
}

export const toGuestPhotoDto = ({ photo, slug, canDelete }: GuestPhotoDtoInput): GuestPhotoDto => ({
  id: photo.id,
  status: photo.status,
  thumbUrl: mediaUrl(slug, photo.id, 'thumb'),
  caption: photo.caption?.value ?? null,
  createdAt: iso(photo.createdAt),
  canDelete,
})

export interface ModerationPhotoDtoInput {
  readonly photo: Photo
  readonly slug: string
  /** Resolved by the caller from the author id; a guest may have no display name. */
  readonly authorName: string | null
}

export const toModerationPhotoDto = ({
  photo,
  slug,
  authorName,
}: ModerationPhotoDtoInput): ModerationPhotoDto => ({
  id: photo.id,
  status: photo.status,
  thumbUrl: mediaUrl(slug, photo.id, 'thumb'),
  displayUrl: mediaUrl(slug, photo.id, 'display'),
  width: photo.dimensions.width,
  height: photo.dimensions.height,
  caption: photo.caption?.value ?? null,
  authorName,
  byteSize: photo.byteSize,
  createdAt: iso(photo.createdAt),
})

export const toGuestDto = (guest: Guest): GuestDto => ({
  id: guest.id,
  displayName: guest.label(),
  joinedAt: iso(guest.joinedAt),
  lastSeenAt: iso(guest.lastSeenAt),
  photoCount: guest.photoCount,
  revoked: guest.isRevoked(),
})

export const toSessionUserDto = (user: User): SessionUserDto => ({
  userId: user.id,
  email: user.email.value,
  displayName: user.displayName,
  mustChangePassword: user.mustChangePassword,
})
