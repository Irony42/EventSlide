/**
 * The wire format, mirroring `web/src/lib/api/dto.ts` and specified in docs/API.md.
 *
 * An entity is never serialised directly. The wire format is a contract: returning
 * the entity would make every internal field rename a breaking API change, and would
 * leak whatever the entity happens to hold — storage keys, absolute paths, the
 * uploader's raw EXIF. Note what is absent from every DTO below.
 */

import type { ClipJobStatus } from '../../../domain/clips/clipJobStatus'
import type { EventStatus } from '../../../domain/events/eventStatus'
import type { EventRole } from '../../../domain/events/eventRole'
import type { MediaKind } from '../../../domain/photos/mediaKind'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import type { ReactionKind } from '../../../domain/reactions/reactionKind'
import type { ReactionCounts } from '../../../domain/reactions/reactionTally'
import type { WallLayout } from '../../../domain/slideshow/wallLayout'

/** What a guest may know about an event, before and after joining. */
export interface PublicEventDto {
  readonly slug: string
  readonly name: string
  readonly allowCaptions: boolean
  readonly allowReactions: boolean
  readonly maxUploadBytes: number
  readonly maxFilesPerUpload: number
}

export interface JoinResponseDto {
  readonly guestId: string
  readonly displayName: string | null
  readonly event: PublicEventDto
}

/**
 * The three fields a clip adds to a row, repeated on each shape that carries them.
 *
 * **Written out rather than inherited from one shared interface**, deliberately.
 * `dtoContract.test.ts` compares each declaration's own members, so an `extends` would
 * hide these fields from it entirely — and hiding them is precisely the wrong outcome
 * while the web app has not been taught to read them: the record that it has not is
 * `UNREAD_BY_CLIENT` in that test, and there is nothing to record if the comparison
 * cannot see the field.
 *
 * Two properties matter, and both are about what an *older* client does with them.
 * `displayUrl` and `thumbUrl` point at the clip's **poster** rather than at a rendition
 * it does not have, so a client that has never heard of video renders a still frame
 * rather than a broken image. And `videoUrl` is `null` for a photograph rather than
 * absent, so nothing has to test for the key's existence.
 */
export interface WallItemDto {
  readonly id: string
  readonly displayUrl: string
  readonly thumbUrl: string
  readonly width: number
  readonly height: number
  readonly caption: string | null
  readonly authorName: string | null
  readonly createdAt: string
  readonly kind: MediaKind
  /** `null` for a photograph. The mp4, which answers `Range` requests. */
  readonly videoUrl: string | null
  /** `null` for a photograph. Milliseconds, measured on the stored file. */
  readonly durationMs: number | null
}

/**
 * What a guest is told about a clip that has no `photos` row yet.
 *
 * It exists because that window is real: between the upload and the transcode there is
 * nothing in the album to show them, and a guest who cannot tell whether it worked sends
 * it again. `photoId` names the row the job will produce and is present whatever the
 * status — it is fixed at staging — so a client can start watching for it immediately.
 */
export interface ClipJobDto {
  readonly clipJobId: string
  readonly status: ClipJobStatus
  readonly photoId: string
  /** The stable code behind a `failed` status; the client picks its French from it. */
  readonly failureCode: string | null
}

export interface WallResponseDto {
  readonly event: { readonly slug: string; readonly name: string }
  /**
   * The join code, because the wall doubles as the invitation.
   *
   * Someone arriving at 23:00 has only the screen to read, and the empty state exists
   * to tell the room how to join — so withholding the code here would break the
   * product to protect something the QR code on every table already gives away.
   *
   * It does widen one accepted risk: a leaked display URL now grants upload as well as
   * read. That is recorded in docs/SECURITY.md, and the mitigation is the one a host
   * already has — rotate the code.
   */
  readonly joinCode: string
  readonly revision: string
  readonly items: readonly WallItemDto[]
  readonly slideIntervalMs: number
  readonly kenBurnsDurationMs: number
  readonly layout: WallLayout
  readonly reactionsEnabled: boolean
}

export type UploadOutcomeDto =
  | { readonly index: number; readonly status: 'accepted'; readonly photoId: string }
  | { readonly index: number; readonly status: 'duplicate'; readonly photoId: string }
  | { readonly index: number; readonly status: 'rejected'; readonly code: string }

export interface UploadResponseDto {
  readonly results: readonly UploadOutcomeDto[]
}

export interface GuestPhotoDto {
  readonly id: string
  readonly status: PhotoStatus
  readonly thumbUrl: string
  readonly caption: string | null
  readonly createdAt: string
  /**
   * Computed server-side from the grace window and the current status. The client
   * must not re-derive it: two implementations of the same rule drift, and then the
   * button is enabled for an action the server will refuse.
   */
  readonly canDelete: boolean
  /** See {@link WallItemDto}. `thumbUrl` is the poster when this row is a clip. */
  readonly kind: MediaKind
  readonly videoUrl: string | null
  readonly durationMs: number | null
}

export interface ModerationPhotoDto {
  readonly id: string
  readonly status: PhotoStatus
  readonly thumbUrl: string
  readonly displayUrl: string
  readonly width: number
  readonly height: number
  readonly caption: string | null
  readonly authorName: string | null
  readonly byteSize: number
  readonly createdAt: string
  /** See {@link WallItemDto}. A host moderating a clip watches it before deciding. */
  readonly kind: MediaKind
  readonly videoUrl: string | null
  readonly durationMs: number | null
}

export interface BulkModerationResponseDto {
  readonly applied: readonly string[]
  readonly skipped: readonly string[]
}

export interface EventSettingsDto {
  readonly moderation: 'manual' | 'auto'
  readonly allowCaptions: boolean
  readonly allowReactions: boolean
  /**
   * The host's veto over video, and separate from whether the box *can* transcode one:
   * a deployment with no encoder refuses a clip with `clip.transcoderUnavailable`, which
   * is an apology, while this is a decision.
   */
  readonly allowClips: boolean
  readonly allowGuestSelfDelete: boolean
  readonly guestSelfDeleteGraceSeconds: number
  readonly retentionDays: number | null
  readonly maxPhotosPerGuest: number | null
}

export interface EventSummaryDto {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly status: EventStatus
  readonly photoCount: number
  readonly pendingCount: number
  readonly guestCount: number
  readonly usedBytes: number
  readonly createdAt: string
}

export interface EventDto extends EventSummaryDto {
  readonly joinCode: string
  /** Built from PUBLIC_URL here, so the QR code and the printed card cannot disagree. */
  readonly joinUrl: string
  readonly quotaBytes: number
  readonly settings: EventSettingsDto
  readonly startsAt: string | null
  readonly closedAt: string | null
  /**
   * When the event opens and closes by itself, as ISO-8601 instants, or `null` for
   * "the host does it". Distinct from `startsAt`, which is the printed start of the
   * party and moves nothing.
   */
  readonly scheduledOpenAt: string | null
  readonly scheduledCloseAt: string | null
  /**
   * When a sweep last threw a due instant away because the lifecycle refused it, or
   * `null`. The console shows it as a notice: the schedule the host set is gone, and
   * this is the only thing that says so. Saving any schedule clears it.
   */
  readonly scheduleDiscardedAt: string | null
  readonly role: EventRole
}

export interface GuestDto {
  readonly id: string
  readonly displayName: string | null
  readonly joinedAt: string
  readonly lastSeenAt: string
  readonly photoCount: number
  readonly revoked: boolean
}

export interface GuestListResponseDto {
  readonly items: readonly GuestDto[]
  readonly activeCount: number
}

export interface ModeratorDto {
  readonly userId: string
  readonly email: string
  readonly displayName: string | null
  readonly role: EventRole
  readonly grantedAt: string
}

export interface SessionUserDto {
  readonly userId: string
  readonly email: string
  readonly displayName: string | null
  readonly mustChangePassword: boolean
}

export type SessionResponseDto =
  | { readonly authenticated: true; readonly user: SessionUserDto }
  | { readonly authenticated: false }

export interface ReactionsResponseDto {
  readonly counts: ReactionCounts
  readonly mine: readonly ReactionKind[]
}

export interface TopPhotoDto {
  readonly photoId: string
  readonly thumbUrl: string
  readonly counts: ReactionCounts
  readonly total: number
}

// ------------------------------------------- moderation routes (additive) --

/**
 * One row of the moderation queue, as `web/src/lib/api/dto.ts` declares it and
 * docs/API.md §6 specifies it. The two declarations describe the same bytes.
 *
 * This row once carried the domain's four-column `QueueItem` projection and a
 * `hasCaption` boolean, on the argument that a caption "has to be read before
 * publishing" — which is the argument *against* a boolean: a badge saying text exists
 * is precisely what does not let the host read it. The moderator's job is to decide
 * what goes on a wall in front of a room, and the caption, the sender and the photo's
 * proportions are what that decision is made of. The console rendered all three from a
 * row that carried none of them, so a host moderating a real event read "par undefined"
 * and "undefined × undefined pixels" on every card.
 *
 * Note what is still absent. This row goes to a moderator rather than to the room, so
 * it may say more than a {@link WallItemDto} — but no content hash, storage key or
 * absolute path appears here, and `byteSize` is not on it because nothing renders it.
 */
export interface ModerationQueueItemDto {
  readonly id: string
  readonly status: PhotoStatus
  readonly thumbUrl: string
  readonly displayUrl: string
  /** Intrinsic size, so the grid does not reflow as thumbnails arrive over venue Wi-Fi. */
  readonly width: number
  readonly height: number
  /** The text that would be projected with the photo, not a badge saying there is one. */
  readonly caption: string | null
  /** `null` for an anonymous guest or a host's own upload; the client words that. */
  readonly authorName: string | null
  readonly createdAt: string
  /**
   * See {@link WallItemDto}. A moderator deciding about a clip has to be able to watch
   * it — a poster frame is not a decision about fifteen seconds of video.
   */
  readonly kind: MediaKind
  readonly videoUrl: string | null
  readonly durationMs: number | null
}

export interface ModerationQueuePageDto {
  readonly items: readonly ModerationQueueItemDto[]
  /**
   * Across the whole event, not the page in hand: a badge that shrank to the page size
   * the moment the host applied a limit would under-report the work left.
   */
  readonly pendingCount: number
  readonly nextCursor: string | null
}

/** The admin gallery: the same photos as the queue, without the queue's ordering. */
export interface PhotoListResponseDto {
  readonly items: readonly ModerationPhotoDto[]
  readonly nextCursor: string | null
}

export interface TopPhotosResponseDto {
  readonly items: readonly TopPhotoDto[]
}
