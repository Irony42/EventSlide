// What the host and moderators read and write.
import type {
  AnnouncementKind,
  AnnouncementState,
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
  WallRevealDto,
} from './common'

/**
 * The recording behind a voice message as the host's console reads it (spec 25): the author's view
 * plus the size, for the card.
 */
export interface GuestbookQueueVoiceDto {
  readonly state: 'reserved' | 'queued' | 'running' | 'ready' | 'failed'
  readonly durationMs: number | null
  readonly bytes: number | null
  /** The optional line the guest wrote with it (140 characters): content, never interface. */
  readonly caption: string | null
}
/** One message in the host's reading of the guestbook (spec 01). */
export interface GuestbookQueueItemDto {
  readonly id: string
  /** `null` for a voice message (spec 25), whose words are its recording; a written one always has it. */
  readonly text: string | null
  /** `null` for a guest who gave no name or whose row is gone; the client words that. */
  readonly authorName: string | null
  readonly status: 'pending' | 'published' | 'rejected' | 'hidden'
  readonly createdAt: string
  /** The decisions this message may take now, from the status machine: the buttons the panel shows. */
  readonly allowedDecisions: readonly ModerationDecision[]
  /** The recording of a voice message, `null` for a written one (spec 25). */
  readonly voice: GuestbookQueueVoiceDto | null
}
export interface GuestbookQueueDto {
  readonly items: readonly GuestbookQueueItemDto[]
  /** The whole book's, not the page's: the badge on the panel. */
  readonly pendingCount: number
  /** Recordings still being processed, left out of `items`: "2 messages vocaux en traitement". */
  readonly voiceProcessing: number
  /** The secret is on: no recording may be heard yet, and the card shows no player. */
  readonly voiceSealed: boolean
  /** When the host set the secret to lift (an instant), or `null` for "when the event ends". */
  readonly voiceOpensAtMs: number | null
  /** The server's now, in milliseconds: a countdown never trusts the console's own clock. */
  readonly serverNowMs: number
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
  /**
   * The messaging channel the sender came through (spec 27: `telegram`), present only then. The console shows a badge
   * "via Telegram" and nothing else: no identifier of the sender crosses.
   */
  readonly via?: string
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
  | {
      readonly status: 'none'
      readonly albumCounts: { readonly photos: number; readonly messages: number }
      readonly offer: {
        readonly maxPhotos: number
        readonly maxMessages: number
        readonly printVersion: boolean
      }
    }
  | {
      readonly status: 'queued' | 'running' | 'done' | 'failed' | 'stale'
      /** What the book was asked to be. */
      readonly options: {
        readonly title: string
        readonly subtitle: string
        readonly language: string
        readonly style: AlbumBookStyle
        readonly selection: AlbumBookSelection
        readonly showAuthors: boolean
        readonly showCaptions: boolean
        readonly includeGuestbook: boolean
        readonly printVersion: boolean
        readonly timeZone: string
      }
      readonly requestedAt: string
      readonly doneAt: string | null
      readonly photoCount: number | null
      readonly skippedCount: number | null
      readonly pageCount: number | null
      readonly byteSize: number | null
      /** The photographs the plan kept, once the render has begun. */
      readonly selectedCount: number | null
      /** A finished book: the screen file, and the printer version's two when it was made. */
      readonly files?: {
        readonly screen: { readonly byteSize: number }
        readonly printInterior?: { readonly byteSize: number }
        readonly printCover?: { readonly byteSize: number }
      }
      /** Why a finished book has no printer version although the host asked for one. */
      readonly printSkipped: 'tooManyPages' | 'tooLarge' | null
      readonly expiresAt: string | null
      readonly failureCode: string | null
      readonly staleReason: string | null
      /** The album now, for the form: published photographs (clips left out) and written messages. */
      readonly albumCounts: { readonly photos: number; readonly messages: number }
      /** What the box lets a book be: its ceiling of photographs and whether it offers the printer version. */
      readonly offer: {
        readonly maxPhotos: number
        readonly maxMessages: number
        readonly printVersion: boolean
      }
    }
/** The three styles of the photo book (spec 26). */
export type AlbumBookStyle = 'classique' | 'magazine' | 'souvenir'
/** Every photograph, or the best ones, to a length (spec 26). */
export type AlbumBookSelection =
  { readonly kind: 'all' } | { readonly kind: 'best'; readonly target: 60 | 120 | 200 }
/**
 * The event's verified archive (spec 22): numbers, instants, the digest of the whole ZIP and closed
 * codes, with the domain's own verdict on whether the album may be deleted without typing the word.
 * Transcribed from `AlbumExportDto` on the server, which the web app cannot import.
 */
export interface AlbumExportDto {
  readonly status: 'queued' | 'running' | 'sealed' | 'stale' | 'failed'
  readonly requestedAt: string
  readonly sealedAt: string | null
  readonly expiresAt: string | null
  readonly entries: number | null
  readonly skipped: number | null
  readonly bytes: number | null
  readonly sha256: string | null
  readonly servedAt: string | null
  readonly staleReason: string | null
  readonly failure: string | null
  readonly canDeleteWithoutConfirmation: boolean
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
/** `POST …/guestbook/voice/keep-pending` (spec 25): how many ready, pending voices were published. */
export interface KeepPendingVoicesResponse {
  readonly kept: number
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
  /** A Telegram group may send its photographs to this event (spec 27). */
  readonly allowTelegram: boolean
  /** The guestbook (spec 01): open for guests, and whether its published messages reach the wall. */
  readonly allowGuestbook: boolean
  /** Guests may save another guest's photograph from the feed (spec 24). */
  readonly allowGuestSave: boolean
  readonly guestbookOnWall: boolean
  /**
   * What the host decides about voice messages (spec 25): off, not sealed, no opening time on an
   * event that predates them. `enabled` only has an effect while `allowGuestbook` is on;
   * `opensAtMs` is an instant in milliseconds, or `null` for "when the event ends".
   */
  readonly guestbookVoice: {
    readonly enabled: boolean
    readonly sealed: boolean
    readonly opensAtMs: number | null
  }
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
  /** The disposable-camera mode (spec 23), as stored; `at` is an instant. Absent from an older server. */
  readonly reveal?: {
    readonly enabled: boolean
    readonly at: string | null
    readonly film: boolean
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
export interface EventPurgeDto {
  readonly at: string | null
  readonly notice: 14 | 3 | 1 | null
  /** The event's client is being offboarded: the deletion band shows however far the date is. */
  readonly offboarding: boolean
  /**
   * The voice messages the purge would take unheard or undecided, from a week before `at` (0 and 0
   * otherwise): how many are still kept secret, how many wait for a decision.
   */
  readonly voices: PurgeVoicesDto
  /** The server's clock when it answered: `at` is counted down against it, not the machine's. */
  readonly serverNowMs: number
}
export interface PurgeVoicesDto {
  readonly secret: number
  readonly pending: number
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
  /**
   * When the album will be deleted (an ISO-8601 instant, or `null` when it is not on a clock) and
   * the threshold of the last warning e-mail (14, 3 or 1 day before, or `null`). Says nothing of the
   * operator's hold on the purge. Optional in the type only so that a fixture older than this field
   * still compiles; every host answer carries it.
   */
  readonly purge?: EventPurgeDto
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
  /**
   * The reveal gate at the server's clock (spec 23), for the console's band: `revealed` is the
   * server's word and `serverNowMs` the clock a countdown is anchored on, never the laptop's.
   * `readyCount` is the published photographs the gate holds back (`null` once revealed or with the
   * mode off); the pending ones are `pendingCount`, which stay hidden after the reveal. Absent from
   * an older server: read as an evening with nothing held back.
   */
  readonly reveal?: WallRevealDto
  /**
   * How many guests' replies were written or changed since the caller last looked (spec 30), for the
   * badge of the menu. **The owner's answer only**; absent for a moderator.
   */
  readonly unseenRsvps?: number
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
/** One announcement as the host's console reads it: the row, and its state at the server's clock. */
export interface AnnouncementDto {
  readonly id: string
  readonly text: string
  readonly kind: AnnouncementKind
  readonly at: string
  readonly durationSeconds: number
  readonly countdownSeconds: number
  readonly state: AnnouncementState
}
/** `GET /events/:slug/announcements`: the host's list, with the clock it was derived at. */
export interface AnnouncementListResponse {
  readonly announcements: readonly AnnouncementDto[]
  readonly serverNowMs: number
}
/** What a schedule, an edit and a launch answer. */
export interface AnnouncementResponse {
  readonly announcement: AnnouncementDto
}
/**
 * One group that sends its photographs to the event (spec 27). `title` is the group's title as Telegram showed it when
 * it was linked; `photoCount` counts the media received through it and is never decremented by an erasure. Nothing
 * here identifies a conversation or a sender.
 */
export interface ChannelBindingDto {
  readonly id: string
  readonly channel: string
  readonly title: string
  readonly boundAt: string
  readonly photoCount: number
}
/** `GET /events/:slug/channels`: what the "Groupe Telegram" panel shows. */
export interface ChannelsResponse {
  /** Whether this box has a bot at all (a token is configured and Telegram accepted it). */
  readonly available: boolean
  /** The bot's public handle, to add to the group; `null` when not available. */
  readonly botUsername: string | null
  /** Whether the client's plan includes messaging channels. */
  readonly allowed: boolean
  /**
   * Whether the bot reads every message of its groups (Telegram's privacy mode is off), `null` without a bot. When it
   * does not, it only sees the photographs of the groups it administers, and the panel warns the host.
   */
  readonly readsAllMessages: boolean | null
  readonly bindings: readonly ChannelBindingDto[]
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
  readonly guestSaves: number
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

/**
 * A photograph of the book preview: the renditions the API serves and the words printed with it.
 * Transcribed from `BookPreviewPhotoDto` on the server.
 */
export interface BookPreviewPhotoDto {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly thumbUrl: string
  readonly displayUrl: string
  readonly caption: string | null
  readonly author: string | null
  readonly mission: string | null
  /** The mission as the book prints it, in the book's language. */
  readonly missionLabel: string | null
  readonly hearts: number
}

/** One page of the plan; a `wide` one has `span: 2` and runs over a double page. */
export interface BookPreviewPageDto {
  readonly template: string
  readonly span: 1 | 2
  readonly chapter: number | null
  readonly photos: readonly BookPreviewPhotoDto[]
  /** Where each photograph sits in this style, in the order of `photos`. */
  readonly slots: readonly {
    readonly x: number
    readonly y: number
    readonly w: number
    readonly h: number
    readonly contain: boolean
    readonly hero: boolean
  }[]
  /** The boxes the page's texts are drawn in. */
  readonly boxes: readonly {
    readonly x: number
    readonly y: number
    readonly w: number
    readonly h: number
  }[]
  readonly messages: readonly { readonly text: string; readonly author: string | null }[]
  readonly firstMessages: boolean
}

/**
 * The plan a book of the chosen options would have (spec 26), made by the server with the code that
 * makes the PDF. Transcribed from `BookPreviewDto`. Moderators only: it carries guest words.
 */
export interface BookPreviewDto {
  readonly style: 'classique' | 'magazine' | 'souvenir'
  readonly colours: {
    readonly paper: string
    readonly ink: string
    readonly accent: string
    readonly accentText: string
    readonly accentStrong: string
    readonly accentInk: string
  }
  /** What the style does to the page. */
  readonly look: {
    readonly fullBleed: boolean
    readonly polaroid: boolean
    readonly minBodySize: number
  }
  readonly language: string
  readonly cover: {
    readonly title: string
    readonly subtitle: string
    readonly photo: BookPreviewPhotoDto
  }
  readonly pages: readonly BookPreviewPageDto[]
  readonly pageCount: number
  readonly photoCount: number
  readonly albumPhotos: number
  readonly chapters: readonly {
    readonly index: number
    readonly numeral: string
    readonly title: string
    readonly subtitle: string
    readonly firstPage: number
  }[]
  readonly contents: readonly { readonly label: string; readonly page: number }[]
  readonly stats: {
    readonly photos: number
    readonly photographers: number
    readonly hearts: number
    readonly messages: number
  }
  readonly texts: {
    readonly contents: string
    readonly statsTitle: string
    readonly statPhotos: string
    readonly statPhotographers: string
    readonly statHearts: string
    readonly statMessages: string
    readonly favourites: string
    readonly guestbook: string
    readonly createdWith: string
  }
  readonly thanks: {
    readonly heading: string
    readonly names: readonly { readonly name: string; readonly photoCount: number }[]
  }
  readonly closingNotes: readonly string[]
}
