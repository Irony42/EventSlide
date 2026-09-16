/**
 * The wire format, transcribed from docs/API.md.
 *
 * Deliberately duplicated rather than imported from `src/`: the web app talks to the
 * server over HTTP only, so the DTO is an explicit contract. Sharing the server's
 * types would make every internal rename a silently breaking API change, and lint
 * forbids the import.
 */

export type PhotoStatus = 'pending' | 'published' | 'rejected' | 'hidden'
export type EventStatus = 'draft' | 'live' | 'closed' | 'archived'
export type ModerationDecision = 'publish' | 'reject' | 'hide'
export type ReactionKind = 'love' | 'laugh' | 'wow' | 'cheers' | 'clap'
export type WallLayout = 'spotlight' | 'mosaic' | 'polaroid' | 'filmstrip' | 'collage' | 'split'
/**
 * What `GET /media/:photoId/:variant` will serve.
 *
 * The clip pair is here because a clip is a facet of a photo and not a parallel thing:
 * the same row, the same moderation queue, two renditions instead of three. The staged
 * upload's `source` is deliberately **absent** — it is outside the server's
 * `SERVED_VARIANTS`, so no route can parse it, and a name for it here would be a name
 * for something a client can never ask for.
 */
export type MediaVariant = 'thumb' | 'display' | 'original' | 'video' | 'poster'
export type EventRole = 'owner' | 'moderator'
/**
 * What a row on the wall actually is.
 *
 * Consulted where a **rule** differs and nowhere else. Everything mechanical about a
 * clip already arrives resolved: `thumbUrl` and `displayUrl` point at its poster frame,
 * so a surface that does not care renders a still and needs no branch at all.
 */
export type MediaKind = 'photo' | 'clip'
/**
 * The life of one transcode, as the guest's phone polls it.
 *
 * A separate machine from `PhotoStatus`, and deliberately: a clip that is still
 * transcoding has no photo row at all, which is what makes "a half-encoded clip reached
 * the projector" unrepresentable rather than filtered out. `reserved` is a window of
 * milliseconds that only a second upload of the same file can observe; a fresh upload
 * answers `queued`.
 */
export type ClipJobStatus = 'reserved' | 'queued' | 'running' | 'done' | 'failed'

export type ReactionCounts = Record<ReactionKind, number>

/** What a guest may know about an event before and after joining. */
export interface PublicEventDto {
  readonly slug: string
  readonly name: string
  readonly allowCaptions: boolean
  readonly allowReactions: boolean
  readonly maxUploadBytes: number
  readonly maxFilesPerUpload: number
  /** The host's switch over video. `false` means: do not offer the control at all. */
  readonly allowClips: boolean
  /**
   * The limits the clip route enforces, so the picker can refuse **before** the bytes
   * go up a venue's Wi-Fi rather than after. Deployment configuration, which is exactly
   * why they travel instead of being compiled in here.
   */
  readonly maxClipBytes: number
  readonly maxClipSeconds: number
}

export interface JoinResponse {
  readonly guestId: string
  readonly displayName: string | null
  readonly event: PublicEventDto
}

/**
 * One row of the wall's playlist.
 *
 * The three clip fields are `null`-valued on a photograph rather than absent, so nothing
 * here tests for a missing key. `displayUrl` and `thumbUrl` point at a clip's **poster**,
 * which is what lets the four layouts that do not play video render one with no branch of
 * their own — see `wallLayoutPlayback.ts` for which two do.
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
 * What a guest is told about a clip that has no photo row yet.
 *
 * It exists because that window is real: between the upload and the transcode there is
 * nothing in "Vos envois" to show them, and a guest who cannot tell whether it worked
 * sends the video again. `photoId` names the row the job will produce and is present
 * whatever the status, so the client can start watching for it immediately — it names an
 * existing photo only once `status` is `done`.
 */
export interface ClipJobDto {
  readonly clipJobId: string
  readonly status: ClipJobStatus
  readonly photoId: string
  /** The stable code behind a `failed` status; the client picks its French from it. */
  readonly failureCode: string | null
}

export interface WallResponse {
  readonly event: { readonly slug: string; readonly name: string }
  /**
   * The join code, because the wall doubles as the invitation while it is empty
   * (DESIGN-SYSTEM.md section 10) and someone arriving at 23:00 has only the screen to
   * read. Optional: a server build that does not present it yet leaves the projector
   * showing the invitation without a code rather than crashing it.
   */
  readonly joinCode?: string
  /** Order-sensitive fingerprint of `items`; unchanged means the playlist did not move. */
  readonly revision: string
  readonly items: readonly WallItemDto[]
  readonly slideIntervalMs: number
  readonly kenBurnsDurationMs: number
  readonly layout: WallLayout
  readonly reactionsEnabled: boolean
}

/** `duplicate` is a success: the same bytes already exist in this event. */
export type UploadOutcome =
  | { readonly index: number; readonly status: 'accepted'; readonly photoId: string }
  | { readonly index: number; readonly status: 'duplicate'; readonly photoId: string }
  | { readonly index: number; readonly status: 'rejected'; readonly code: string }

export interface UploadResponse {
  readonly results: readonly UploadOutcome[]
}

export interface GuestPhotoDto {
  readonly id: string
  readonly status: PhotoStatus
  readonly thumbUrl: string
  readonly caption: string | null
  readonly createdAt: string
  /** Computed server-side from the grace window and the status, so the two never disagree. */
  readonly canDelete: boolean
  /** See {@link WallItemDto}. `thumbUrl` is the poster when this row is a clip. */
  readonly kind: MediaKind
  readonly videoUrl: string | null
  readonly durationMs: number | null
}

/**
 * One row of `GET /api/events/:slug/moderation`.
 *
 * The server declares the same bytes as `ModerationQueueItemDto` in
 * `src/interface/http/presenters/dto.ts`, and docs/API.md §6 specifies them. Keep the
 * three in step: nothing validates this shape at runtime — the transport asserts it
 * onto whatever JSON arrives — so a field this interface claims and the server does not
 * send is `undefined` on screen while both sides typecheck. That is exactly how the
 * moderation card came to read "par undefined" to a host mid-event.
 *
 * `byteSize` was on this row and is gone: no surface renders it, and a field nobody
 * shows is one more thing for the two declarations to disagree about.
 */
export interface ModerationPhotoDto {
  readonly id: string
  readonly status: PhotoStatus
  readonly thumbUrl: string
  readonly displayUrl: string
  /** Intrinsic size: the grid is laid out before the thumbnails arrive. */
  readonly width: number
  readonly height: number
  /** The text that would be projected with the photo. The host reads it before deciding. */
  readonly caption: string | null
  /** `null` for a guest who chose not to give a name, which is a supported choice. */
  readonly authorName: string | null
  readonly createdAt: string
  /**
   * See {@link WallItemDto}. A moderator deciding about a clip has to be able to watch
   * it — a poster frame is not a decision about fifteen seconds of video in front of
   * two hundred people.
   */
  readonly kind: MediaKind
  readonly videoUrl: string | null
  readonly durationMs: number | null
}

export interface ModerationQueueResponse {
  readonly items: readonly ModerationPhotoDto[]
  /** Across the whole event, not the page in hand. */
  readonly pendingCount: number
  readonly nextCursor: string | null
}

export interface BulkModerationResponse {
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
   *
   * It reads `false` for every event stored before clips shipped, which is why the
   * settings form has to carry it: without the checkbox the feature is unreachable on
   * exactly the events it exists for.
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
  readonly joinUrl: string
  readonly quotaBytes: number
  readonly settings: EventSettingsDto
  readonly startsAt: string | null
  readonly closedAt: string | null
  /**
   * When the event opens and closes by itself, as ISO-8601 instants, or `null` for
   * "the host does it". Not `startsAt`, which is the printed start of the party and
   * moves nothing.
   */
  readonly scheduledOpenAt: string | null
  readonly scheduledCloseAt: string | null
  /**
   * When a sweep last threw a due instant away because the lifecycle refused it, or
   * `null`. Rendered as a notice on the settings page: the schedule the host set is
   * gone, and this is the only thing that says so. Saving any schedule clears it.
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

export interface GuestListResponse {
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

export type SessionResponse =
  | { readonly authenticated: true; readonly user: SessionUserDto }
  | { readonly authenticated: false }

export interface ReactionsResponse {
  readonly counts: ReactionCounts
  readonly mine: readonly ReactionKind[]
}

export interface TopPhotoDto {
  readonly photoId: string
  readonly thumbUrl: string
  readonly counts: ReactionCounts
  readonly total: number
}
