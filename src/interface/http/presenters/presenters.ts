import type { Event } from '../../../domain/events/event'
import type { EventRole } from '../../../domain/events/eventRole'
import type { EventSettings } from '../../../domain/events/eventSettings'
import type { Guest } from '../../../domain/guests/guest'
import type { Photo } from '../../../domain/photos/photo'
import type { User } from '../../../domain/users/user'
import type { EventSummary } from '../../../application/ports/eventRepository'
import type { MediaVariant, ServedVariant } from '../../../application/ports/mediaStore'
import type { MediaKind } from '../../../domain/photos/mediaKind'
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
 * Which rendition each role resolves to, per kind.
 *
 * **A lookup, not an `if`.** Everything mechanical about a clip is indexed by its kind
 * rather than branched on: domain and application are gated at 100% branches and this
 * layer at 90%, so a conditional at every call site costs a photo test and a clip test
 * for the rest of the project — and the table is what makes "a clip's thumbnail is its
 * poster" a fact written in one place instead of a rule repeated in four presenters.
 *
 * The consequence is the useful one: a client that has never heard of video still gets a
 * working `thumbUrl` and `displayUrl` for a clip, and renders a still frame rather than
 * a broken image.
 */
const DISPLAY_VARIANT: Readonly<Record<MediaKind, ServedVariant>> = {
  photo: 'display',
  clip: 'poster',
}

const THUMB_VARIANT: Readonly<Record<MediaKind, ServedVariant>> = {
  photo: 'thumb',
  clip: 'poster',
}

/** `null` where there is nothing to play, so no client tests for a missing key. */
const PLAYABLE_VARIANT: Readonly<Record<MediaKind, ServedVariant | null>> = {
  photo: null,
  clip: 'video',
}

/** The three fields a clip adds to every row that can be one. */
export const toMediaFacetDto = (
  photo: Photo,
  slug: string,
): { kind: MediaKind; videoUrl: string | null; durationMs: number | null } => {
  const playable = PLAYABLE_VARIANT[photo.kind]
  const facet = photo.facet

  return {
    kind: photo.kind,
    videoUrl: playable === null ? null : mediaUrl(slug, photo.id, playable),
    durationMs: facet.kind === 'clip' ? facet.duration.ms : null,
  }
}

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
  allowClips: settings.allowClips,
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
  scheduledOpenAt: isoOrNull(event.scheduledOpenAt),
  scheduledCloseAt: isoOrNull(event.scheduledCloseAt),
  scheduleDiscardedAt: isoOrNull(event.scheduleDiscardedAt),
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
  thumbUrl: mediaUrl(slug, photo.id, THUMB_VARIANT[photo.kind]),
  caption: photo.caption?.value ?? null,
  createdAt: iso(photo.createdAt),
  canDelete,
  ...toMediaFacetDto(photo, slug),
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
  thumbUrl: mediaUrl(slug, photo.id, THUMB_VARIANT[photo.kind]),
  displayUrl: mediaUrl(slug, photo.id, DISPLAY_VARIANT[photo.kind]),
  width: photo.dimensions.width,
  height: photo.dimensions.height,
  caption: photo.caption?.value ?? null,
  authorName,
  byteSize: photo.byteSize,
  createdAt: iso(photo.createdAt),
  ...toMediaFacetDto(photo, slug),
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
import type { ModerationQueueRow } from '../../../application/usecases/moderation/getModerationQueue'
import type { ClipJobStatus } from '../../../domain/clips/clipJobStatus'
import type { ReactionCounts } from '../../../domain/reactions/reactionTally'
import type { ClipJobDto, ModerationQueueItemDto, TopPhotoDto } from './dto'

export interface ModerationQueueItemDtoInput {
  readonly row: ModerationQueueRow
  readonly slug: string
}

/**
 * One queue row.
 *
 * Takes the use case's `ModerationQueueRow` rather than a `Photo`: the console's read
 * model is assembled by `getModerationQueue`, which resolves the sender's name in one
 * batched read. A presenter that reached for a repository to fill `authorName` would be
 * a controller doing a second read — and the field that was left `null` instead is what
 * the console rendered as "par undefined".
 *
 * The image URLs are still derived from the id and the slug, by the same builder the
 * wall and the printed card use, so the grid renders without a second read. `hasCaption`
 * does not cross: the row carries the caption itself, and a client can see for itself
 * whether there is one.
 */
export const toModerationQueueItemDto = ({
  row,
  slug,
}: ModerationQueueItemDtoInput): ModerationQueueItemDto => ({
  id: row.id,
  status: row.status,
  thumbUrl: mediaUrl(slug, row.id, THUMB_VARIANT[row.kind]),
  displayUrl: mediaUrl(slug, row.id, DISPLAY_VARIANT[row.kind]),
  width: row.width,
  height: row.height,
  caption: row.caption,
  authorName: row.authorName,
  createdAt: iso(row.createdAt),
  kind: row.kind,
  // From the row rather than from a `Photo`: this presenter is handed the use case's
  // read model, and reaching for a repository here would be a controller doing a second
  // read — the defect that put "par undefined" on a host's screen.
  videoUrl: PLAYABLE_VARIANT[row.kind] === null ? null : mediaUrl(slug, row.id, 'video'),
  durationMs: row.durationMs,
})

/**
 * A clip that has no `photos` row yet, for the guest who is waiting for it.
 *
 * One presenter for two shapes — the upload's answer and the poll's — because they are
 * the same fact at two moments, and two would drift. `duplicate` does not cross: a client
 * acts on the status, and a second flag saying the same thing is a second thing to keep
 * in step.
 */
export const toClipJobDto = (view: {
  readonly clipJobId: string
  readonly status: ClipJobStatus
  readonly photoId: string
  readonly failureCode: string | null
}): ClipJobDto => ({
  clipJobId: view.clipJobId,
  status: view.status,
  photoId: view.photoId,
  failureCode: view.failureCode,
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
export const toSessionResponseDto = (principal: UserPrincipal | undefined): SessionResponseDto =>
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
 * `authorName` is the name the guest typed at `/join` for exactly this purpose, and it
 * arrives from the use case: `getWallPlaylist` carries `authorNames` in its view, so this
 * presenter joins a map it was handed rather than the controller performing a second
 * repository read — the one thing a controller may not do.
 *
 * It is `null` whenever there is nobody to name: a guest who stayed anonymous, a photo
 * the host uploaded from the venue's own camera, or a guest row that is gone. The wall
 * then shows no credit at all rather than a stand-in, because "Invité" is French UI copy
 * and lives in `web/src/lib/i18n/fr.ts` — the same line `Guest.label()` draws. The
 * projector's alt text still says the photo came from a guest; the scrim carries no name.
 *
 * Note what is absent, and note that the author's *name* is the only thing that was
 * added: no status, no byte size, no content hash, no storage key, and no guest id. The
 * projector is a public client in a room of strangers, and a wall item is the least it
 * needs to render a slide.
 */
const toWallItemDto = (photo: Photo, slug: string, authorName: string | null): WallItemDto => ({
  id: photo.id,
  displayUrl: mediaUrl(slug, photo.id, DISPLAY_VARIANT[photo.kind]),
  thumbUrl: mediaUrl(slug, photo.id, THUMB_VARIANT[photo.kind]),
  width: photo.dimensions.width,
  height: photo.dimensions.height,
  caption: photo.caption?.value ?? null,
  authorName,
  createdAt: iso(photo.createdAt),
  ...toMediaFacetDto(photo, slug),
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
    // The wall doubles as the invitation: its empty state exists to tell the room how
    // to join, and someone arriving at 23:00 has only the screen to read. The cost —
    // a leaked display URL now grants upload as well as read — is recorded in
    // docs/SECURITY.md §12, and the host's mitigation is to rotate the code.
    joinCode: view.event.joinCode.value,
    revision: view.playlist.revision,
    items: view.playlist.items.flatMap((id) => {
      const photo = byId.get(id)
      // A playlist id with no photo behind it is not reachable through the use case, which
      // builds both from one read. Skipping rather than emitting a placeholder keeps the
      // failure mode "one slide short" instead of a hole the projector has to render.
      return photo === undefined
        ? []
        : [toWallItemDto(photo, slug, view.authorNames.get(id) ?? null)]
    }),
    slideIntervalMs: view.slideIntervalMs,
    kenBurnsDurationMs: view.kenBurnsDurationMs,
    layout: view.layout,
    reactionsEnabled: view.event.settings.allowReactions,
  }
}

// ------------------------------------------------ event routes (additive) --

// Imported here rather than folded into the statement list at the top of the file, so
// that route modules being written against this file at the same time merge cleanly.
// Type-only, so nothing is added to the bundle.
import type { MembershipWithUser } from '../../../application/ports/userRepository'
import type { RegisterModeratorResult } from '../../../application/usecases/auth/registerModerator'
import type { ModeratorDto } from './dto'

/**
 * One membership, for the host's "who has the console" list.
 *
 * The address is here because it is how the host recognises the person they invited,
 * and it is only ever shown to an owner of that same event. Note what is absent: no
 * password state, no last login, nothing about the other events that account may run —
 * a membership row is not a window onto a colleague's account.
 */
export const toModeratorDto = (membership: MembershipWithUser): ModeratorDto => ({
  userId: membership.userId,
  email: membership.email,
  displayName: membership.displayName,
  role: membership.role,
  grantedAt: iso(membership.grantedAt),
})

/**
 * The answer to an invitation.
 *
 * `created` is the useful half: it says whether the temporary password the host just
 * typed is worth reading out. An address that already had an account keeps its own
 * password — an invitation that reset it would let one host take over a colleague's
 * account, and with it every other event that colleague runs.
 */
export interface ModeratorInviteDto {
  readonly userId: string
  readonly created: boolean
}

export const toModeratorInviteDto = (result: RegisterModeratorResult): ModeratorInviteDto => ({
  userId: result.userId,
  created: result.created,
})
