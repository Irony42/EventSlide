/**
 * The wire format, mirroring `web/src/lib/api/dto.ts` and specified in docs/API.md.
 *
 * An entity is never serialised directly. The wire format is a contract: returning
 * the entity would make every internal field rename a breaking API change, and would
 * leak whatever the entity happens to hold — storage keys, absolute paths, the
 * uploader's raw EXIF. Note what is absent from every DTO below.
 */

import type { ClipJobStatus } from '../../../domain/clips/clipJobStatus'
import type { EventLanguage } from '../../../domain/events/eventLanguage'
import type { EventStatus } from '../../../domain/events/eventStatus'
import type { ThemeFonts, ThemeFrame, ThemeMaterial } from '../../../domain/events/eventTheme'
import type { EventRole } from '../../../domain/events/eventRole'
import type { MissionScope } from '../../../domain/missions/missionScope'
import type { MediaKind } from '../../../domain/photos/mediaKind'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import type {
  NoticeAcknowledgementStatus,
  NoticeAudience,
  NoticePublication,
} from '../../../domain/privacy/privacyNotice'
import type { ReactionKind } from '../../../domain/reactions/reactionKind'
import type { ReactionCounts } from '../../../domain/reactions/reactionTally'
import type { WallLayout } from '../../../domain/slideshow/wallLayout'

/**
 * What a guest may know about an event, before and after joining.
 *
 * The three clip fields are here for one reason: **a refusal has to happen before the
 * bytes do.** A guest on venue Wi-Fi who picks a 200 MB recording and is told `413` after
 * pushing it for four minutes has lost the four minutes and, on a phone that went to
 * sleep halfway, the recording's place in their evening as well. The only way the picker
 * can refuse first is to know the same numbers the route enforces, and the only honest
 * way for it to know them is to be told — a constant compiled into the bundle is a second
 * copy of `MAX_CLIP_BYTES` that no deployment's `.env` can move.
 *
 * `allowClips` is the same argument about the host's switch rather than the box's limits:
 * without it the guest surface would offer a video control that answers
 * `403 event.clipsNotAllowed` after the upload, on exactly the events — the ones that
 * predate the feature — where the persistence fallback reads `false`.
 */
/**
 * How one event looks (roadmap 2.2), as three settled choices rather than as colours.
 *
 * **No colour crosses this wire, and that is the design.** `accentHue` is an angle; the
 * lightness and chroma that turn it into a palette live in `tokens.css`, which is still
 * the only file in the product that declares a colour. A client applies the hue as
 * `--accent-hue` — the one category of custom property the design system lets JavaScript
 * set, beside a duration and a tilt — and the stylesheet does the rest.
 *
 * It travels on three responses because three different surfaces need it and each one
 * learns about its event from a different place: the wall from `GET /wall`, the guest's
 * phone from the join it already performed, the host's console from the event it is
 * editing.
 */
export interface EventThemeDto {
  /** Degrees on the oklch hue circle, 0-359. Validated for legibility server-side. */
  readonly accentHue: number
  readonly fonts: ThemeFonts
  readonly frame: ThemeFrame
  /**
   * Whether the event's panes wear the glass material (roadmap 11.5).
   *
   * It travels with the rest of the look rather than as a client concern, because it is the
   * host's decision about their evening and not the viewer's about their phone. What the
   * viewer's machine has to say about it — a missing capability, a stated preference, a
   * frame rate that stopped holding — is decided in the browser and outranks this, so
   * `plain` here means "never the material" and `glass` means "the material, if this
   * machine can hold it".
   */
  readonly material: ThemeMaterial
}

export interface PublicEventDto {
  readonly slug: string
  readonly name: string
  readonly allowCaptions: boolean
  readonly allowReactions: boolean
  readonly maxUploadBytes: number
  readonly maxFilesPerUpload: number
  /** The host's switch over video. `false` means: do not offer the control at all. */
  readonly allowClips: boolean
  /** `MAX_CLIP_BYTES`. Separate from `maxUploadBytes`, which is the photo path's. */
  readonly maxClipBytes: number
  /** `MAX_CLIP_SECONDS`. Seconds, because that is the unit a guest is told about. */
  readonly maxClipSeconds: number
  /**
   * The event's look, so the upload screen is the host's event rather than the product.
   *
   * It rides on the join response because the guest surface has no other way to learn it
   * — there is deliberately no readable "event by slug" — and because a theme that
   * arrived a network round trip later would repaint the screen under a guest's thumb.
   */
  readonly theme: EventThemeDto
}

/**
 * What a guest is told happens to a photo before they send one (roadmap §5.1).
 *
 * **Values, not sentences.** The server decides every clause from the event's settings
 * (`src/domain/privacy/privacyNotice.ts`) and the client words them in the guest's
 * language, so a notice cannot say "checked before the screen" on an event that
 * publishes on arrival: there is no field that could carry that sentence independently of
 * the setting that makes it true.
 *
 * This deliberately tells a guest two things `PublicEventDto` does not — the moderation
 * mode, as `publication`, and the retention period. They are exactly what a guest is
 * entitled to know about their own photographs, and they reach them only here, framed as
 * what happens to their photo rather than as the host's settings.
 */
export interface PrivacyNoticeDto {
  /** Opaque. Echoed back when the guest acknowledges, and compared with the one in force. */
  readonly revision: string
  readonly publication: NoticePublication
  /**
   * Who sees a photo, in reading order. A list so a third audience — the shared gallery
   * of roadmap §4.1 — is one more member rather than a new field.
   */
  readonly audiences: readonly NoticeAudience[]
  /** Days after the gallery closes. `null`: nothing deletes the album on its own. */
  readonly retentionDays: number | null
  /** How long a guest may take a photo back themselves. `null`: they cannot. */
  readonly selfRemovalSeconds: number | null
}

/** A notice and where this device stands with it: every read of the notice answers this. */
export interface PrivacyNoticeStateDto {
  readonly notice: PrivacyNoticeDto
  readonly acknowledgement: NoticeAcknowledgementStatus
}

export interface JoinResponseDto {
  readonly guestId: string
  readonly displayName: string | null
  readonly event: PublicEventDto
  /**
   * Beside the event rather than inside it: the notice is about the event, but whether it
   * has been read is about this device, and the two travel together on every response
   * that carries either.
   */
  readonly privacyNotice: PrivacyNoticeStateDto
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
  /**
   * The absolute link the QR on the projector encodes, built from `PUBLIC_URL`.
   *
   * Here rather than assembled in the browser, and that is the whole point of the field.
   * The wall used to build it from `window.location.origin`, which is the address *this
   * screen* was opened on — so a projector pointed at `http://mini-pc.local:4300` printed
   * a QR for a hostname no guest's phone can resolve, and one behind a TLS-terminating
   * proxy printed plain `http`, on which the `Secure` guest cookie is never sent. It is
   * the 1.0 QR bug (CLAUDE.md §9 trap 1) with a different five-character mismatch: the
   * code beneath the QR was right and the link inside it was not.
   *
   * `PUBLIC_URL` is already validated as *the* origin a guest can reach this box on, and
   * `joinUrl` already built this same link for the host's own event page. The projector
   * was the one surface printing the QR a guest actually scans, and the one inventing its
   * own answer.
   */
  readonly joinUrl: string
  readonly revision: string
  readonly items: readonly WallItemDto[]
  readonly slideIntervalMs: number
  readonly kenBurnsDurationMs: number
  readonly layout: WallLayout
  readonly reactionsEnabled: boolean
  /**
   * The host's prompts and how the room is answering them (roadmap §2.1).
   *
   * On this response rather than on a second request, for the same reason the theme is:
   * a projector runs unattended and every extra fetch is another thing that can be
   * half-applied. It is also what makes the panel current without polling — every signal
   * on the event's channel provokes one refetch of exactly this response.
   *
   * **Empty for the overwhelming majority of events**, which set no prompts at all, and
   * an empty array is what stops the wall drawing a panel.
   */
  readonly missions: readonly WallMissionDto[]
  /**
   * What the room is meant to look like.
   *
   * On this response rather than on a second request, because the wall must not paint a
   * frame in the product's colours and then repaint in the host's: a projector that
   * blinks on every reload is a defect two hundred people notice. Arriving here, the
   * theme and the photos it themes are rendered together.
   */
  readonly theme: EventThemeDto
  /**
   * The language this screen renders its own words in (roadmap 1.5). On this response for
   * the theme's reason — the projector must not paint one language and repaint in another
   * — and it is the only way the wall can know.
   *
   * Required, not optional, unlike `theme` and `missions`: those were added to a response
   * older clients already parsed, and this one ships with its reader.
   */
  readonly wallLanguage: EventLanguage
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
  /** The host's own copy: what the picker on the settings form is showing. */
  readonly theme: EventThemeDto
  /**
   * The language the projected wall speaks (roadmap 1.5). On the host's settings response
   * and **not** on `PublicEventDto`: putting it on the join response would invite a client
   * to prefer it over the guest's own choice, the single thing this field must never do.
   */
  readonly wallLanguage: EventLanguage
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

/**
 * One of the host's prompts, on the host's own console (roadmap 2.1).
 *
 * The three numbers are what a host at a laptop mid-evening actually wants: has anybody
 * answered this at all, how many photographs, how many different guests. None of them is
 * stored — they are counted over published photographs on every read, which is what makes
 * them fall again the moment a host takes a photograph down.
 *
 * What is absent is the list of photographs. A mission's photographs are ordinary
 * photographs and are already in the queue and the gallery; naming them here would be
 * the second gallery 2.1 says not to build.
 */
export interface MissionDto {
  readonly id: string
  /** As the host typed it. Content, never interface copy: nothing translates it. */
  readonly prompt: string
  readonly scope: MissionScope
  /** Has the room answered it at all? See `isAchieved`. */
  readonly achieved: boolean
  readonly publishedPhotos: number
  readonly completedByGuests: number
}

export interface MissionListResponseDto {
  readonly items: readonly MissionDto[]
}

/**
 * One row of the guest's checklist.
 *
 * Deliberately narrower than {@link MissionDto}, and the omissions are the design.
 * `publishedPhotos` and `completedByGuests` are not here: a guest needs to know whether
 * there is still something for them to do, and a count of what everybody else has done
 * is a scoreboard. Section 7 of the roadmap rules out social features between guests,
 * and the cheapest way to build one by accident is to ship the numbers and let a screen
 * find a use for them.
 *
 * `scope` stays because it is what explains a ticked row the guest did not tick: "la
 * première danse" is answered once, by somebody, for everybody.
 */
export interface GuestMissionDto {
  readonly id: string
  readonly prompt: string
  readonly scope: MissionScope
  /** Whether this guest still has something to do about this prompt. */
  readonly done: boolean
}

export interface GuestMissionListResponseDto {
  readonly items: readonly GuestMissionDto[]
}

/**
 * One prompt as the room sees it.
 *
 * `completedByGuests` is on this shape and not on the guest's for a reason that is about
 * what each screen draws rather than about who may know what: the wall renders a
 * per-guest prompt as a number because a tick would be wrong for something two hundred
 * people can each answer, and it renders a once-for-the-evening prompt as a tick. That
 * is the only place `scope` changes a pixel.
 *
 * There is no "answered at" here and therefore nothing a wall could use to celebrate a
 * completion for three seconds and then stop — see `WallMissionStanding` for why that
 * was declined.
 */
export interface WallMissionDto {
  readonly id: string
  readonly prompt: string
  readonly scope: MissionScope
  readonly achieved: boolean
  readonly completedByGuests: number
}
