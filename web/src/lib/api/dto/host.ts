// What the host and moderators read and write.
import type {
  EventBrandDto,
  EventLanguage,
  EventRole,
  EventStatus,
  EventThemeDto,
  MediaKind,
  MissionScope,
  ModerationDecision,
  PhotoStatus,
  ReactionCounts,
  WallLayout,
} from './common'

/** One message in the host's reading of the guestbook (spec 01). */
export interface GuestbookQueueItemDto {
  readonly id: string
  readonly text: string
  /** `null` for a guest who gave no name or whose row is gone; the client words that. */
  readonly authorName: string | null
  readonly status: 'pending' | 'published' | 'rejected' | 'hidden'
  readonly createdAt: string
  /** The decisions this message may take now, from the status machine: the buttons the panel shows. */
  readonly allowedDecisions: readonly ModerationDecision[]
}
export interface GuestbookQueueDto {
  readonly items: readonly GuestbookQueueItemDto[]
  /** The whole book's, not the page's: the badge on the panel. */
  readonly pendingCount: number
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
   * See `WallItemDto` (wall.ts). A moderator deciding about a clip has to be able to watch
   * it — a poster frame is not a decision about fifteen seconds of video in front of
   * two hundred people.
   */
  readonly kind: MediaKind
  readonly videoUrl: string | null
  readonly durationMs: number | null
  /**
   * The decisions this photo may take now, from the server's status machine. The console
   * shows exactly these buttons and keeps no copy of the rule: a client table drifts, and
   * the click then ends in `photo.illegalTransition`.
   */
  readonly allowedDecisions: readonly ModerationDecision[]
  /**
   * The host's star (spec 08). Optional: a server older than this field omits it, and the
   * console then shows every photo as not starred rather than failing.
   */
  readonly highlighted?: boolean
}
/**
 * The event's photo book (spec 04): `none` when the host never asked for one. Transcribed from
 * `AlbumBookDto` on the server, which the web app cannot import. No guest text: the title and
 * subtitle are the host's own, `failureCode` and `staleReason` are closed lists.
 */
export type AlbumBookDto =
  | { readonly status: 'none' }
  | {
      readonly status: 'queued' | 'running' | 'done' | 'failed' | 'stale'
      readonly options: {
        readonly title: string
        readonly subtitle: string
        readonly language: string
        readonly layout: 'one' | 'four'
        readonly showAuthors: boolean
        readonly showCaptions: boolean
      }
      readonly requestedAt: string
      readonly doneAt: string | null
      readonly photoCount: number | null
      readonly skippedCount: number | null
      readonly pageCount: number | null
      readonly byteSize: number | null
      readonly expiresAt: string | null
      readonly failureCode: string | null
      readonly staleReason: string | null
    }
/** The best-of panel's read: how many favourites can be exported (spec 08). */
export interface HighlightsDto {
  readonly count: number
  /** The montage of the favourites; `null` when none was ever asked for. Optional: older server. */
  readonly reel?: ReelDto | null
}
export type ReelStatusDto = 'queued' | 'running' | 'done' | 'failed' | 'stale'
/** The montage's state. The photograph ids never travel: only how many, and how long. */
export interface ReelDto {
  readonly status: ReelStatusDto
  readonly photoCount: number
  readonly durationMs?: number
  readonly byteSize?: number
  readonly failureCode?: string
  readonly updatedAt: string
}
export interface PreselectHighlightsResponse {
  readonly added: number
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
  /** The guestbook (spec 01): open for guests, and whether its published messages reach the wall. */
  readonly allowGuestbook: boolean
  readonly guestbookOnWall: boolean
  readonly allowGuestSelfDelete: boolean
  readonly guestSelfDeleteGraceSeconds: number
  readonly retentionDays: number | null
  readonly maxPhotosPerGuest: number | null
  /** The host's own copy: what the picker on the settings form is showing. */
  readonly theme: EventThemeDto
  /** The host's welcome message (spec 03). Optional: a server build that predates it sends none. */
  readonly brand?: EventBrandDto
  /**
   * The language the projected wall speaks (roadmap 1.5). Here and deliberately **not** on
   * `PublicEventDto`: a client that preferred it over a guest's own choice would be doing
   * the single thing this field must never do.
   */
  readonly wallLanguage: EventLanguage
  /** How the wall behaves for every screen (spec 13): `null` is "not chosen". Merged per key. */
  readonly wall: {
    readonly layout: WallLayout | null
    readonly slideIntervalMs: number | null
    readonly mixedEnabled: boolean
    readonly mixedWallSeconds: number
    readonly mixedSlideshowSeconds: number
    readonly souvenirCounter: boolean
    readonly newPhotoSignal: boolean
    readonly freshLane: boolean
    readonly tilt: boolean
    readonly showTime: boolean
    readonly qrVisible: boolean
    readonly qrScale: number
    readonly qrPlacement: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start'
    readonly soundEnabled: boolean
    readonly soundTone: 'bell' | 'chime' | 'drop' | 'pop'
    readonly soundVolume: number
  }
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
  /**
   * What the caller is in this event. The dashboard reads it to leave out the lifecycle buttons
   * a moderator's request would be refused; `eventLifecycle.canManageEvent` is a hand-kept
   * transcription of the domain's rule.
   */
  readonly role: EventRole
}
export interface EventDto extends EventSummaryDto {
  readonly joinCode: string
  readonly joinUrl: string
  /**
   * The quota the event's uploads are judged against: the stored one, lowered to the client's
   * ceiling when that is smaller. The host's meter is drawn against this and never against a
   * number the box no longer holds the event to.
   */
  readonly quotaBytes: number
  /** When the live window closes, an ISO-8601 instant. **Absent** when there is none to announce. */
  readonly liveWindowEnd?: string
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
/**
 * One of the host's prompts on the host's own console (roadmap §2.1).
 *
 * The three numbers are counted over published photographs on every read, never stored —
 * which is what makes them fall again the moment a host takes a photograph down.
 */
export interface MissionDto {
  readonly id: string
  /** As the host typed it. Content, never interface copy: nothing translates it. */
  readonly prompt: string
  readonly scope: MissionScope
  readonly achieved: boolean
  readonly publishedPhotos: number
  readonly completedByGuests: number
}
export interface MissionListResponse {
  readonly items: readonly MissionDto[]
}
/** The console's view: the wall's, plus the mission it names (to say which row is running). */
export interface HostChallengeDto {
  readonly id: string
  readonly missionId: string | null
  readonly prompt: string
  readonly startedAt: string
  readonly endsAt: string
  readonly state: 'running' | 'ended'
  readonly answers: number | null
}
/** `GET /events/:slug/challenge`: the host's console read. */
export interface HostChallengeResponse {
  readonly serverNowMs: number
  readonly challenge: HostChallengeDto | null
  /** Past challenge texts, newest first, at most five: the host's suggestions (spec 18). */
  readonly recent: readonly string[]
}
/**
 * A challenge as a host's launch answers it (spec 10). Instants are ISO 8601, the prompt is the
 * frozen copy. The wall and the phones read a different, smaller shape.
 */
export interface ChallengeDto {
  readonly id: string
  readonly missionId: string | null
  readonly prompt: string
  readonly startedAt: string
  readonly endsAt: string
  readonly state: 'running'
}
export interface ModeratorDto {
  readonly userId: string
  readonly email: string
  readonly displayName: string | null
  readonly role: EventRole
  readonly grantedAt: string
}
/**
 * What `POST /api/events/:slug/moderators` answers, as the server presents it: a 201 saying
 * the invitation exists and when it ends — and, **only when no mail went out**, the link to
 * pass on. It says nothing about whether the address already has an account.
 */
export interface ModeratorInviteResponse {
  readonly status: 'invited'
  readonly expiresAt: string
  readonly link?: string
}
export interface TopPhotoDto {
  readonly photoId: string
  readonly thumbUrl: string
  readonly counts: ReactionCounts
  readonly total: number
}
/** A non-empty 15-minute slot, `start` an ISO instant in UTC. The browser regroups into local hours. */
export interface StatsQuarterDto {
  readonly start: string
  readonly count: number
}
/** One of the ten guests the page names. A first name is content: shown as written. */
export interface StatsContributorDto {
  readonly displayName: string
  readonly photos: number
  readonly reactions: number
}
/** What the after-party counters hold, summed over the days; `since` is the first day counted. */
export interface EngagementDto {
  readonly since: string
  readonly galleryViews: number
  readonly galleryArchiveDownloads: number
}
/**
 * The host statistics page (spec 05). Everything is derived from the album at read time.
 * `photos` means sends, photographs and videos alike. `engagement` is `null` until a first
 * open of the album link or ZIP was counted.
 */
export interface EventStatsResponse {
  readonly uploads: {
    readonly total: number
    readonly byQuarter: readonly StatsQuarterDto[]
  }
  readonly photos: {
    readonly pending: number
    readonly published: number
    readonly rejected: number
    readonly hidden: number
  }
  readonly guests: {
    readonly joined: number
    readonly contributors: number
    readonly revoked: number
    readonly activeNow: number
  }
  readonly reactions: {
    readonly total: number
    readonly byKind: ReactionCounts
  }
  readonly topContributors: readonly StatsContributorDto[]
  readonly anonymousContributors: {
    readonly guests: number
    readonly photos: number
  }
  readonly engagement: EngagementDto | null
}
