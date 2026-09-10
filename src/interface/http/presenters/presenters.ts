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

// ------------------------------------------- moderation routes (additive) --

// Imported here rather than folded into the statement list at the top of the file, so
// that five route modules being written against this file at the same time merge
// cleanly. Type-only, so nothing is added to the bundle.
import type { QueueItem } from '../../../domain/moderation/moderationQueue'
import type { ReactionCounts } from '../../../domain/reactions/reactionTally'
import type { ModerationQueueItemDto, TopPhotoDto } from './dto'

export interface ModerationQueueItemDtoInput {
  readonly item: QueueItem
  readonly slug: string
}

/**
 * One queue row.
 *
 * Takes the domain's `QueueItem` rather than a `Photo`, because that is what
 * `getModerationQueue` returns: the four columns every queue rule needs, projected out
 * of the `(event_id, status, created_at DESC)` index. The image URLs are derived from
 * the id and the slug — the same builder the wall and the printed card use — so the
 * grid renders from the projection alone.
 */
export const toModerationQueueItemDto = ({
  item,
  slug,
}: ModerationQueueItemDtoInput): ModerationQueueItemDto => ({
  id: item.id,
  status: item.status,
  thumbUrl: mediaUrl(slug, item.id, 'thumb'),
  displayUrl: mediaUrl(slug, item.id, 'display'),
  hasCaption: item.hasCaption,
  createdAt: iso(item.createdAt),
})

export interface TopPhotoDtoInput {
  readonly photo: Photo
  readonly slug: string
  readonly counts: ReactionCounts
  readonly total: number
}

/**
 * "Photo de la soirée".
 *
 * Only the thumb is offered: the panel is a podium of small tiles beside the wall, and
 * handing the projector a second full-size URL per entry would have it fetch megabytes
 * it never renders.
 */
export const toTopPhotoDto = ({ photo, slug, counts, total }: TopPhotoDtoInput): TopPhotoDto => ({
  photoId: photo.id,
  thumbUrl: mediaUrl(slug, photo.id, 'thumb'),
  counts,
  total,
})

// ------------------------------------------------ auth routes (additive) --

// Imported here rather than folded into the statement list at the top of the file, so
// that several route modules being written against this file at the same time merge
// cleanly. Type-only, so nothing is added to the bundle.
import type { AuthenticatedUser } from '../../../application/usecases/auth/authenticateUser'
import type { UserPrincipal } from '../types'
import type { SessionResponseDto } from './dto'

/**
 * What a successful login answers with.
 *
 * Takes the use case's `AuthenticatedUser` and not the `User` entity, which is why
 * {@link toSessionUserDto} cannot serve here: `authenticateUser` deliberately returns
 * an identity and nothing else, so the entity never reaches the HTTP layer at all
 * (docs/adr/0004-remove-passport.md). This is the one response that can carry a fresh
 * `displayName`, because it is the one moment the row was read.
 */
export const toSignedInUserDto = (user: AuthenticatedUser): SessionUserDto => ({
  userId: user.userId,
  email: user.email,
  displayName: user.displayName,
  mustChangePassword: user.mustChangePassword,
})

/**
 * `GET /api/auth/me`, built from the session principal alone.
 *
 * `displayName` is `null` here rather than the stored name. The session holds an
 * identity and nothing more (`SessionPayload`), so a name in it would be a copy that
 * goes stale the moment the account is renamed — and reading the row would make a
 * controller touch a repository, which is the one thing a controller may not do. The
 * login response carries the fresh name; this endpoint answers the question it is
 * actually asked, which is whether the caller is signed in.
 */
export const toSessionResponseDto = (
  principal: UserPrincipal | undefined,
): SessionResponseDto =>
  principal === undefined
    ? { authenticated: false }
    : {
        authenticated: true,
        user: {
          userId: principal.userId,
          email: principal.email,
          displayName: null,
          mustChangePassword: principal.mustChangePassword,
        },
      }

// ----------------------------------------------- guest routes (additive) --

// Imported here rather than folded into the statement list at the top of the file, so
// that route modules being written against this file at the same time merge cleanly.
// Type-only, so nothing is added to the bundle.
import type {
  UploadOutcome,
  UploadPhotosResult,
} from '../../../application/usecases/photos/uploadPhotos'
import type { PhotoReactionsView } from '../../../application/usecases/reactions/getPhotoReactions'
import type { ReactionsResponseDto, UploadOutcomeDto, UploadResponseDto } from './dto'

/**
 * One file's fate.
 *
 * `duplicate` is a **success** and carries the id of the photo that already holds those
 * bytes: a double-tapped "Envoyer", or a retry after the connection dropped mid-upload,
 * must read as "it is already there" rather than as a failure the guest answers by
 * sending it a third time. 1.0 answered it with a second identical slide on the wall.
 *
 * A refusal crosses the wire as its `code` and nothing else — the client picks its
 * French from that, and `declaredName` stays out of the response body: the guest matches
 * an outcome to a row in their picker by `index`, and echoing a client-supplied filename
 * back into a document is how it ends up rendered somewhere it should not be.
 */
export const toUploadOutcomeDto = (outcome: UploadOutcome): UploadOutcomeDto => {
  switch (outcome.kind) {
    case 'stored':
      return { index: outcome.index, status: 'accepted', photoId: outcome.photoId }
    case 'duplicate':
      return { index: outcome.index, status: 'duplicate', photoId: outcome.photoId }
    case 'refused':
      return { index: outcome.index, status: 'rejected', code: outcome.error.code }
  }
}

/**
 * One entry per submitted file, in the order they were submitted.
 *
 * `published` is deliberately absent from the wire format: on an auto-publish event
 * every accepted photo is live, and a second list of the same ids would let a client
 * decide a photo's status from the upload response instead of from the photo.
 */
export const toUploadResponseDto = (result: UploadPhotosResult): UploadResponseDto => ({
  results: result.outcomes.map(toUploadOutcomeDto),
})

/**
 * The badge counts under one photo, plus this phone's own taps.
 *
 * `counts` comes through unchanged from the domain's `tally`, which always carries every
 * kind at zero — so no client handles a missing key. `total` is dropped: it exists to
 * rank the photo of the night, and a phone that summed a different way would show a
 * number the host's panel disagrees with.
 */
export const toReactionsDto = (view: PhotoReactionsView): ReactionsResponseDto => ({
  counts: view.counts,
  mine: view.mine,
})

// ---------------------------------------------- public routes (additive) --

// Imported here rather than folded into the statement list at the top of the file, so
// that route modules being written against this file at the same time merge cleanly.
// Type-only, so nothing is added to the bundle.
import type { WallPlaylistView } from '../../../application/usecases/slideshow/getWallPlaylist'
import type { PhotoId } from '../../../domain/shared/ids'
import type { WallItemDto, WallResponseDto } from './dto'

/**
 * One slide.
 *
 * `authorName` is `null` because the wall's read model carries no guest identity:
 * `getWallPlaylist` returns published photos and their playlist, and resolving an author
 * would mean either a second repository read from a controller — the one thing a
 * controller may not do — or a use case that returns names it does not have today. The
 * field stays on the wire because docs/API.md declares it nullable, so filling it later
 * is an addition rather than a breaking change.
 *
 * Note what is absent: no status, no byte size, no content hash, no storage key. The
 * projector is a public client, and a wall item is the least it needs to render a slide.
 */
const toWallItemDto = (photo: Photo, slug: string): WallItemDto => ({
  id: photo.id,
  displayUrl: mediaUrl(slug, photo.id, 'display'),
  thumbUrl: mediaUrl(slug, photo.id, 'thumb'),
  width: photo.dimensions.width,
  height: photo.dimensions.height,
  caption: photo.caption?.value ?? null,
  authorName: null,
  createdAt: iso(photo.createdAt),
})

/**
 * The projected wall.
 *
 * The **playlist** decides which photos are on the wall and in what order — never the
 * photo list the repository happened to return. `buildPlaylist` applies the window and
 * the newest-first rule with an id tie-break, so two projectors handed the same photos
 * compute the same sequence and the same `revision`; iterating `view.photos` here would
 * quietly reintroduce 1.0's per-browser slideshow order.
 *
 * Takes no {@link PresenterContext}: every URL on this response is a relative media path,
 * so the wall renders identically whether the projector reached the server by its public
 * URL or by its address on the venue's LAN.
 */
export const toWallResponseDto = (view: WallPlaylistView): WallResponseDto => {
  const slug = view.event.slug.value
  const byId = new Map(view.photos.map((photo): readonly [PhotoId, Photo] => [photo.id, photo]))

  return {
    event: { slug, name: view.event.name.value },
    revision: view.playlist.revision,
    items: view.playlist.items.flatMap((id) => {
      const photo = byId.get(id)
      // A playlist id with no photo behind it is not reachable through the use case, which
      // builds both from one read. Skipping rather than emitting a placeholder keeps the
      // failure mode "one slide short" instead of a hole the projector has to render.
      return photo === undefined ? [] : [toWallItemDto(photo, slug)]
    }),
    slideIntervalMs: view.slideIntervalMs,
    kenBurnsDurationMs: view.kenBurnsDurationMs,
    layout: view.layout,
    reactionsEnabled: view.event.settings.allowReactions,
  }
}
