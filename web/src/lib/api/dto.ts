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

/** The font pairing and the frame style an event's theme selects (roadmap 2.2). */
export type ThemeFonts = 'sans' | 'serif'
export type ThemeFrame = 'soft' | 'square' | 'round'
/** The material its panes are made of (roadmap 11.5). Both renderings already ship. */
export type ThemeMaterial = 'glass' | 'plain'

/**
 * The preset an event's settings are created from (roadmap 3.5).
 *
 * A **request** vocabulary and nothing else. It rides on `POST /api/events`, is applied
 * once, and never comes back: no response in this file carries it, because the event
 * stores the values rather than the name of where they came from. If one ever appears on
 * an `EventDto`, the template has stopped being a copy and started being an attachment —
 * see `src/domain/events/eventTemplate.ts` for why that is the wrong product.
 */
export type EventTemplateKey = 'wedding' | 'birthday' | 'conference' | 'party'

/**
 * Who one of the host's prompts is asked of (roadmap §2.1).
 *
 * `guest` is answered once per guest — "un selfie avec les mariés", which two hundred
 * people can each do. `event` is answered once for the room — "la première danse", which
 * happens once, and which one guest's photograph therefore ticks for everybody.
 */
export type MissionScope = 'guest' | 'event'

/**
 * How one event looks, as three settled choices rather than as colours.
 *
 * **No colour crosses this wire.** `accentHue` is an angle; the lightness and chroma that
 * turn it into a palette are declared once in `tokens.css`, which stays the only file in
 * the product holding a raw colour. `design-system/eventTheme.ts` applies it as
 * `--accent-hue` on the surface that carries it.
 */
export interface EventThemeDto {
  /** Degrees on the oklch hue circle, 0-359. The server refuses one it cannot read. */
  readonly accentHue: number
  readonly fonts: ThemeFonts
  readonly frame: ThemeFrame
  /**
   * Whether this event's panes wear the glass material (roadmap 11.5).
   *
   * `design-system/glass.ts` composes it with what the machine has to say, and the host's
   * `plain` is the only one of the two answers that is final: `glass` still loses to a
   * device that cannot afford the filter or to a budget that has shed it.
   */
  readonly material: ThemeMaterial
}

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
  /**
   * The event's look, so the upload screen is the host's event rather than the product.
   *
   * It arrives with the join because there is deliberately no readable "event by slug":
   * the upload screen reads this out of the session the join wrote, which is why the
   * guest's phone paints the right colour on the first frame instead of repainting one
   * round trip later, under their thumb.
   */
  readonly theme: EventThemeDto
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
  /**
   * The absolute link the QR encodes, built by the server from `PUBLIC_URL`.
   *
   * Never rebuilt here from `window.location.origin`, which is what this used to do: that
   * is the address the *projector* was opened on, and a wall on the venue's LAN then
   * printed a QR no guest's phone could resolve. The server knows the address a phone can
   * reach; the screen does not.
   *
   * Optional for the same reason `joinCode` is — a server build that predates the field
   * must not crash the projector. The wall then shows no join block at all rather than
   * falling back to its own origin: no QR is a gap a host can work around with the printed
   * cards, and a QR pointing somewhere wrong is a guest's evening lost in silence.
   */
  readonly joinUrl?: string
  /** Order-sensitive fingerprint of `items`; unchanged means the playlist did not move. */
  readonly revision: string
  readonly items: readonly WallItemDto[]
  readonly slideIntervalMs: number
  readonly kenBurnsDurationMs: number
  readonly layout: WallLayout
  readonly reactionsEnabled: boolean
  /**
   * What the room is meant to look like.
   *
   * On this response rather than behind a second request, so the wall never paints a
   * frame in the product's colours and then repaints in the host's — a projector that
   * blinks on every reload is a defect the room notices.
   *
   * Optional, like `joinCode` above and for the same reason: a server build that predates
   * theming leaves the projector on the default look rather than crashing it.
   */
  readonly theme?: EventThemeDto
  /**
   * The host's prompts and how the room is answering them (roadmap §2.1).
   *
   * On this response rather than behind a second request, for the reason the theme is: a
   * projector runs unattended, and one fetch that either arrives or does not beats two
   * that can half-arrive. It is also what keeps the panel current without polling — the
   * wall refetches this whole response on every signal on the event's channel.
   *
   * Optional, like `theme` and `joinCode` above: a server build that predates missions
   * leaves the projector drawing no panel rather than crashing it. **An empty array
   * means the same thing**, and is what nearly every event sends.
   */
  readonly missions?: readonly WallMissionDto[]
}

/**
 * One prompt as the room sees it.
 *
 * `scope` is the only field that changes a pixel here: a once-for-the-evening prompt is
 * drawn with a tick, a per-guest one with `completedByGuests`, because a tick would be
 * wrong for something two hundred people can each answer.
 */
export interface WallMissionDto {
  readonly id: string
  readonly prompt: string
  readonly scope: MissionScope
  readonly achieved: boolean
  readonly completedByGuests: number
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
  /** The host's own copy: what the picker on the settings form is showing. */
  readonly theme: EventThemeDto
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

/**
 * One row of the guest's checklist, and what it leaves out is the point.
 *
 * No counts: a guest needs to know whether there is still something for *them* to do,
 * and how many other people have done it is a scoreboard — which §7 of the roadmap rules
 * out, and which the cheapest way to build by accident is to ship the numbers and let a
 * screen find a use for them.
 */
export interface GuestMissionDto {
  readonly id: string
  readonly prompt: string
  readonly scope: MissionScope
  readonly done: boolean
}

export interface GuestMissionListResponse {
  readonly items: readonly GuestMissionDto[]
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
