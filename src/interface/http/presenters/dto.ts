/**
 * The wire format, mirroring `web/src/lib/api/dto.ts` and specified in docs/API.md.
 *
 * An entity is never serialised directly. The wire format is a contract: returning
 * the entity would make every internal field rename a breaking API change, and would
 * leak whatever the entity happens to hold — storage keys, absolute paths, the
 * uploader's raw EXIF. Note what is absent from every DTO below.
 */

import type { EventStatus } from '../../../domain/events/eventStatus'
import type { EventRole } from '../../../domain/events/eventRole'
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

export interface WallItemDto {
  readonly id: string
  readonly displayUrl: string
  readonly thumbUrl: string
  readonly width: number
  readonly height: number
  readonly caption: string | null
  readonly authorName: string | null
  readonly createdAt: string
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
}

export interface ModerationQueueResponseDto {
  readonly items: readonly ModerationPhotoDto[]
  readonly pendingCount: number
  readonly nextCursor: string | null
}

export interface BulkModerationResponseDto {
  readonly applied: readonly string[]
  readonly skipped: readonly string[]
}

export interface EventSettingsDto {
  readonly moderation: 'manual' | 'auto'
  readonly allowCaptions: boolean
  readonly allowReactions: boolean
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
 * One row of the moderation queue.
 *
 * Deliberately **not** a {@link ModerationPhotoDto}. `getModerationQueue` returns the
 * domain's four-column `QueueItem` projection — id, status, arrival, whether the guest
 * attached text — because the host works through hundreds of rows on a laptop while
 * more arrive over SSE, and not one queue rule needs a photo's dimensions, bytes or
 * author. The two image URLs are derived from the id and the slug, so the grid still
 * renders without a second read.
 */
export interface ModerationQueueItemDto {
  readonly id: string
  readonly status: PhotoStatus
  readonly thumbUrl: string
  readonly displayUrl: string
  /**
   * A caption is projected at the size of the room and has to be read before
   * publishing, so the row carries the badge rather than the text.
   */
  readonly hasCaption: boolean
  readonly createdAt: string
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
