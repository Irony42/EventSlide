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
import type {
  ThemeAmbiance,
  ThemeFaces,
  ThemeFonts,
  ThemeFrame,
  ThemeGround,
  ThemeMaterial,
} from '../../../domain/events/eventTheme'
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
  /** The ambiance the guest's phone and the wall wear (docs/adr/0010-event-ambiances.md). */
  readonly ambiance: ThemeAmbiance
  /**
   * The host's own ambiance (ADR 0011), present only when `ambiance` is `custom`: absent from the
   * wire otherwise, never `null`.
   */
  readonly custom?: ThemeCustomDto
  /**
   * Where the host's own photograph of their venue is served, replacing the ambiance's bundled
   * ground; `null` when they have not uploaded one, when the ambiance paints no photograph, and
   * on the shared gallery. A path on this origin that names the photograph's digest, so it
   * changes when the photograph does.
   */
  readonly groundUrl: string | null
}

/** The host's own ambiance as it travels (ADR 0011): two angles' worth of freedom and borrowed faces. */
export interface ThemeCustomDto {
  readonly ground: ThemeGround
  /** Degrees on the oklch hue circle, 0-359. */
  readonly groundHue: number
  readonly faces: ThemeFaces
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
  /**
   * Who hosts the photo: `OPERATOR_NAME` (roadmap G2-17). **Present only when the operator
   * named themselves**, so a self-hosted box answers the notice it always answered and a
   * client has no key to render. It is part of `revision`: a guest who read a notice with no
   * operator is asked to read this one.
   */
  readonly operator?: string
}

/** A notice and where this device stands with it: every read of the notice answers this. */
export interface PrivacyNoticeStateDto {
  readonly notice: PrivacyNoticeDto
  readonly acknowledgement: NoticeAcknowledgementStatus
}

/**
 * What a phone is told about the event a join code names, **before** it joins
 * (`GET /api/join/:code`). Everything a guest needs to confirm "yes, this is the wedding I am
 * at" and nothing else: this is the lookup an attacker can enumerate, so every field here is a
 * field they get too. No id, no owner, no quota, no counts, no theme.
 */
export interface JoinTargetDto {
  readonly slug: string
  readonly name: string
  /** True whenever this answers at all: the doors are open. */
  readonly acceptsGuests: boolean
  readonly allowCaptions: boolean
  readonly allowReactions: boolean
}

/** The name a guest's photos are now signed with (`PATCH /api/events/:slug/guests/:guestId`). */
export interface RenamedGuestDto {
  readonly guestId: string
  /** As stored, so trimmed and folded: what the wall will print. `null`: no name. */
  readonly displayName: string | null
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

/** `GET /events/:slug/photos/mine`: the guest's own photos, and whether the event still takes more. */
export interface MyPhotosDto {
  readonly items: readonly GuestPhotoDto[]
  readonly acceptingUploads: boolean
  /**
   * The event's look **now**, so a guest who joined before the host changed it learns of it.
   *
   * The join's copy is a snapshot and the upload screen cannot refetch the event (there is no
   * readable "event by slug"), so this is the read it already makes that can carry the news.
   */
  readonly theme: EventThemeDto
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
  /**
   * What the caller is **in this event**: the one fact the dashboard needs to leave out the
   * lifecycle buttons a moderator's request would be refused (`403`). Whether a role may do a
   * thing stays the domain's call (`canManageEvent`); the console holds a hand-kept transcription of
   * that rule (`web/src/features/admin/eventLifecycle.ts`), which states the domain test's facts.
   */
  readonly role: EventRole
}

export interface EventDto extends EventSummaryDto {
  readonly joinCode: string
  /** Built from PUBLIC_URL here, so the QR code and the printed card cannot disagree. */
  readonly joinUrl: string
  /**
   * The quota the event's uploads are **judged against**: the number it was created with,
   * lowered to its client's `max_event_quota_bytes` when that is smaller (G2-16 / P3-17). The
   * host's meter is drawn against this and not against the stored number, which an operator
   * can have made a promise the box no longer keeps. Equal to the stored quota for an event with
   * no client, so a box that has none answers exactly as it always did.
   */
  readonly quotaBytes: number
  /**
   * When the event's live window closes (`opened_at + max_live_days`, an ISO-8601 instant), so
   * the host sees the end of it before the sweep acts. **Absent**, never `null`, for an event
   * with no window to announce: no client, no `max_live_days`, or one that has not opened yet.
   */
  readonly liveWindowEnd?: string
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

/**
 * The answer to an invitation (docs/API.md, `POST /api/events/:slug/moderators`): that it was
 * written, and until when it works — and, **only when no mail went out**, the link for the
 * inviter to pass on.
 *
 * What is deliberately absent, and was the whole of the 2.x answer: whether an account was
 * created, and its id. They said whether the address was already on the box, to whoever typed
 * it. The answer is now the same for an address that has an account and one that has not, and
 * `link` is a fact about the box and its relay, never about the address.
 */
export interface InvitationIssuedDto {
  readonly status: 'invited'
  readonly expiresAt: string
  readonly link?: string
}

/**
 * What a link would do, for the page that asks its holder to accept: the purpose, the target's
 * name and when it ends. Nothing about the inviter, the address, or whether the address has an
 * account (`previewInvitation` says why).
 */
export interface InvitationPreviewDto {
  readonly kind: 'event' | 'client'
  readonly role: 'moderator' | 'owner' | 'member'
  readonly targetName: string
  readonly expiresAt: string
  /**
   * The terms accepting agrees to (G2-20), **present only on a box that asks for them**: a
   * self-hosted box answers the four keys it always did, byte for byte. `url` is an https
   * address or a path on this site, and `version` is what the audit entry will say.
   */
  readonly terms?: { readonly url: string; readonly version: string }
}

/**
 * What was accepted and where the person lands: for an event its slug, which the page opens.
 * **No address and no account id**: the person who accepted has them, and a response that
 * carried the address would tell whoever holds a link whose mailbox it was.
 */
export interface InvitationAcceptedDto {
  readonly status: 'accepted'
  readonly kind: 'event' | 'client'
  readonly role: 'moderator' | 'owner' | 'member'
  readonly targetName: string
  readonly eventSlug: string | null
}

export interface SessionUserDto {
  readonly userId: string
  readonly email: string
  readonly displayName: string | null
  readonly mustChangePassword: boolean
}

/**
 * Who `GET /api/auth/me` says is signed in: the identity the login answered with, plus the
 * one fact the account menu will need and a login cannot know it will need.
 *
 * `canOperateSite` is the account's **authority over the box** (`siteRole === 'operator'`,
 * read from storage on this request) — not whether the operator's console exists on this
 * instance. That is `features.siteAdmin` on `GET /api/about`, and the console entry the SPA
 * will offer (G2-15) needs both to be true. It grants nothing: `/api/site` is behind `requireOperator`
 * whatever this says.
 */
export interface CurrentUserDto extends SessionUserDto {
  readonly canOperateSite: boolean
  /** Where the account stands with the second factor (G2-13 / P3-15). */
  readonly secondFactor: SecondFactorStatusDto
}

/**
 * What the console needs to decide between "carry on", "enrol", and "enter your code" — and
 * nothing it could use to attack the factor.
 *
 * - `available`: this box has a key, so an operator can enrol and a code can be checked.
 * - `enrolled`: the account has a confirmed authenticator.
 * - `verified`: **this session** has passed the second factor.
 * - `required`: this account must have, before `/api/site` answers: the box requires it of
 *   operators and the account is one. A console that sees `required && !verified` routes to
 *   the enrolment when `!enrolled`, and to the code prompt otherwise.
 */
export interface SecondFactorStatusDto {
  readonly available: boolean
  readonly enrolled: boolean
  readonly verified: boolean
  readonly required: boolean
}

/**
 * `POST /api/auth/login` for an account that has an authenticator: the password was right and
 * **no session was started**. The caller asks for a code and sends it to
 * `POST /api/auth/login/2fa`. Deliberately no identity in it.
 */
export interface SecondFactorRequiredDto {
  readonly secondFactorRequired: true
}

/**
 * `POST /api/auth/2fa/enroll`: the secret, once, in the two forms an authenticator takes it.
 * The URI carries the secret too — treat both as the secret they are (`no-store`).
 */
export interface TotpEnrolmentDto {
  readonly otpauthUri: string
  readonly secret: string
}

/** Recovery codes, shown once as `K7QM-2XTR-9PHD-4VNB`: only their digests are kept. */
export interface RecoveryCodesDto {
  readonly recoveryCodes: readonly string[]
}

export type SessionResponseDto =
  | { readonly authenticated: true; readonly user: CurrentUserDto }
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

// ------------------------------------------- moderation routes --

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

// ----------------------------------------------------------- shared gallery --

/**
 * The event's shared gallery link as its owner sees it (roadmap §4.1).
 *
 * **No URL.** Only the token's digest is stored, so the console cannot show the address a
 * second time; it is on {@link ShareLinkCreatedDto}, once, and nowhere else. `available`
 * is what a guest opening it right now would get — computed by the rule the gallery
 * itself asks, so the console and a phone cannot disagree.
 */
export interface ShareLinkDto {
  readonly id: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly hasPassword: boolean
  readonly available: boolean
}

/** `GET /events/:slug/share-link`: the current link, or `null` when there is none. */
export interface ShareLinkResponseDto {
  readonly link: ShareLinkDto | null
}

/** `POST /events/:slug/share-link`: the new link, and its address — the only time it exists. */
export interface ShareLinkCreatedDto {
  readonly link: ShareLinkDto
  readonly url: string
}

/**
 * `GET /gallery/:token`: what a guest opening the link is shown above the grid.
 *
 * Nothing here is sent before the password: a locked link answers `401` with no body but
 * the error, so a forwarded link does not even disclose whose wedding it is.
 */
export interface GalleryDto {
  /** Content: the host's own words, shown exactly as typed. */
  readonly eventName: string
  /** The event's look, so the guest's own phone wears the accent and material it chose. */
  readonly theme: EventThemeDto
  readonly photoCount: number
  readonly expiresAt: string
  /** The whole album as a ZIP. Signed, and good for an hour. */
  readonly archiveUrl: string
}

/** One tile of the gallery's grid, with the three signed URLs a viewer needs. */
export interface GalleryPhotoDto {
  readonly id: string
  readonly kind: MediaKind
  readonly width: number
  readonly height: number
  /** Content, as the guest typed it; `null` when there is none. */
  readonly caption: string | null
  readonly previewUrl: string
  readonly viewUrl: string
  readonly downloadUrl: string
}

/** `GET /gallery/:token/photos`: one page, and the sealed cursor to the next. */
export interface GalleryPageDto {
  readonly items: readonly GalleryPhotoDto[]
  readonly nextCursor: string | null
}

/**
 * What a box can and cannot do, as the SPA reads it without probing for it.
 *
 * Additive on purpose: the instance-information endpoint grows one flag per capability
 * that a client would otherwise have to discover by trying (forgot-password, e-mail
 * invitations, content reports), and a client that does not know a flag ignores it.
 */
export interface AboutFeaturesDto {
  /**
   * `SITE_ADMIN=on` (docs/ROADMAP.md §10.9): the operator's namespace `/api/site` is
   * mounted. It is what the SPA reads instead of probing a path that answers 401 in one
   * mode and 404 in the other.
   */
  readonly siteAdmin: boolean
  /**
   * The box can mail a password-reset link (`SMTP_URL` is set). The sign-in page offers
   * "forgot your password?" only when this is `true`; with no relay the route answers
   * `404 feature.unavailable`, because a reset link shown on the screen of whoever typed an
   * address would be an account takeover. Always present, so a client reads `false` rather
   * than guessing from absence.
   */
  readonly forgotPassword: boolean
}

/**
 * The operator's optional links, present **only when set** (roadmap G4-02): an instance
 * that asks for nothing answers `{}`, so a client has no key to render and a self-hosted
 * box says nothing about money. Additive, like `features`: a client ignores a key it does
 * not know.
 *
 * Neither link is a condition of anything. A donation buys no counterpart — no tier, no
 * badge, no priority — so there is no field here that could say who gave.
 */
export interface AboutLinksDto {
  /** `LEGAL_TERMS_URL`: the terms of use. An https address or a path on this site. */
  readonly terms?: string
  /** `LEGAL_PRIVACY_URL`: the privacy policy. An https address or a path on this site. */
  readonly privacy?: string
  /** `LEGAL_NOTICE_URL`: the legal notice. An https address or a path on this site. */
  readonly legalNotice?: string
  /** `SUPPORT_URL`: help for a host. An https address or a path on this site. */
  readonly support?: string
  /** `REPORT_URL`: where to report a piece of content (DSA art. 16). Same kinds of address. */
  readonly report?: string
  /** `DONATION_URL`: where to support the project. An https address. */
  readonly donate?: string
  /** `BUDGET_URL`: the public ledger the donations are accounted in. An https address. */
  readonly budget?: string
}

/**
 * Who runs this box (roadmap G2-17 / P3-18), present **only when the operator named
 * themselves**: a self-hosted box has no one to name and answers without the key.
 */
export interface AboutOperatorDto {
  /** `OPERATOR_NAME`. Plain text, never markup. */
  readonly name: string
  /** `OPERATOR_CONTACT_EMAIL`. Present only when set, and never without a `name`. */
  readonly contactEmail?: string
}

/**
 * `GET /api/about` — what this box is, and where its source is (roadmap G1-04 / P1-05).
 *
 * **`sourceUrl` is the AGPL section 13 offer.** A user of a network service is entitled
 * to the corresponding source of the version they are talking to, and this is the
 * address, machine-readable. There is no configuration that omits it and no flag that
 * hides it: the operator can say *where* the source is, never that there is none.
 */
export interface AboutDto {
  readonly name: string
  readonly version: string
  readonly license: 'AGPL-3.0-only'
  readonly sourceUrl: string
  /** Who runs the box. Absent until the operator names themselves; see {@link AboutOperatorDto}. */
  readonly operator?: AboutOperatorDto
  /** Operator links. Empty until the box has any to offer; see {@link AboutLinksDto}. */
  readonly links: AboutLinksDto
  readonly features: AboutFeaturesDto
}

/**
 * `GET /api/site/client-defaults` (free plan G2-18): the ceilings a client is created with
 * when the operator names none, which the console pre-fills its provisioning form with.
 *
 * **Seven of a client's nine ceilings**, the ones `NEW_CLIENT_*` can set: `liveAllowed` has no
 * default (a new client is allowed to open) and `periodStartedAt` is the day of provisioning,
 * supplied by the server. `null` is "no ceiling", which is every value on a box that set none.
 */
export interface ClientDefaultsDto {
  readonly ceilings: {
    readonly maxEvents: number | null
    readonly maxEventsPerPeriod: number | null
    readonly maxTotalBytes: number | null
    readonly maxEventQuotaBytes: number | null
    readonly maxRetentionDays: number | null
    readonly maxLiveDays: number | null
    readonly clipsAllowed: boolean
  }
}

// ----------------------------------------------------------------- client space --

/**
 * The nine ceilings of a client, as the client reads them in its own space
 * (`GET /api/me/limits`, G2-16 / P3-17). `null` is "no ceiling". Copied field by field by
 * `toClientLimitsDto`: a field the domain grows later reaches a client only when somebody
 * decides it should.
 */
export interface CeilingsDto {
  readonly maxEvents: number | null
  readonly maxTotalBytes: number | null
  readonly maxEventQuotaBytes: number | null
  readonly maxRetentionDays: number | null
  readonly clipsAllowed: boolean
  readonly liveAllowed: boolean
  readonly maxLiveDays: number | null
  readonly maxEventsPerPeriod: number | null
  readonly periodStartedAt: string | null
}

export type CeilingLevelDto = 'ok' | 'warning' | 'reached'

/** One ceiling that has a bound, against what the client has used of it. */
export interface CeilingMeterDto {
  readonly kind: 'events' | 'eventsPerPeriod' | 'storage'
  readonly used: number
  readonly max: number
  /** `warning` from 90 per cent, `reached` at 100: decided by the server, once. */
  readonly level: CeilingLevelDto
}

/** What a client has used against its ceilings. */
export interface ClientUsageDto {
  readonly events: number
  readonly eventsCreatedInPeriod: number
  /** The figure the byte ceiling is judged against, clips still queued included. */
  readonly usedBytes: number
}

export interface ClientLimitsDto {
  readonly id: string
  readonly name: string
  /** What the caller is in this client. */
  readonly role: 'owner' | 'member'
  /** Frozen by the operator: reading and exporting still work, writing does not. */
  readonly suspended: boolean
  readonly ceilings: CeilingsDto
  readonly usage: ClientUsageDto
  readonly meters: readonly CeilingMeterDto[]
}

/** `GET /api/me/limits`: the caller's own clients and nobody else's. */
export interface MyLimitsDto {
  readonly clients: readonly ClientLimitsDto[]
}

/**
 * One line of the log of a client, as its owner reads it (`GET /api/client/audit`).
 *
 * **No account is named.** `actor` says what kind of actor did it and, for an integration, its
 * label; never the id of the operator or of the member behind it. `subject.id` is present for
 * a client and an invitation, which the owner can match against their own list, and **absent**
 * for an account, whose id means nothing to its reader and identifies a person.
 */
export interface ClientAuditEntryDto {
  readonly seq: number
  readonly at: string
  readonly action: string
  readonly actor: {
    readonly kind: 'operator' | 'member' | 'system' | 'integration'
    readonly label: string | null
  }
  readonly subject: { readonly type: string; readonly id?: string }
  /** Numbers, switches and instants: what the action's allow-list admits, and nothing typed. */
  readonly details: Readonly<Record<string, unknown>>
}

export interface ClientAuditPageDto {
  readonly items: readonly ClientAuditEntryDto[]
  /** The `before` of the next page, or `null` when this was the last one. */
  readonly next: number | null
}

export interface PendingInvitationDto {
  readonly id: string
  readonly email: string
  readonly role: 'owner' | 'member'
  readonly createdAt: string
  readonly expiresAt: string
}

export interface PendingInvitationsDto {
  readonly items: readonly PendingInvitationDto[]
}

// ------------------------------------------------------------ the operator's namespace --
//
// `/api/site` (G2-14 / P3-13). **Server-side declarations only**, until the console (G2-15) reads
// them: nothing in `web/` consumes these yet, so `dtoContract.test.ts` has no client shape to pair
// them with. What they may contain is decided upstream, by the closed field vocabulary of
// `domain/site/siteOverviewRows.ts`, and each is written field by field in
// `siteOverviewPresenter.ts`, never spread from a row.

/** One client of the box: a name, ceilings and sizes. Never an event, a member or a photograph. */
export interface SiteClientDto {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly suspendedAt: string | null
  readonly purgeAfter: string | null
  readonly ceilings: CeilingsDto
  readonly eventsCreatedInPeriod: number
  readonly usage: {
    readonly eventCount: number
    readonly liveEventCount: number
    readonly memberCount: number
    readonly usedBytes: number
  }
}

export interface SiteClientPageDto {
  readonly items: readonly SiteClientDto[]
  /** The `after` of the next page, or `null` when this was the last one. */
  readonly next: string | null
}

/** One event of a client, as shapes and sizes: no name, no slug, no join code, no photograph. */
export interface SiteEventDto {
  readonly id: string
  readonly status: string
  readonly createdAt: string
  readonly startsAt: string | null
  readonly openedAt: string | null
  readonly closedAt: string | null
  readonly quotaBytes: number
  readonly usedBytes: number
  readonly photoCount: number
}

export interface SiteEventPageDto {
  readonly items: readonly SiteEventDto[]
  readonly next: string | null
}

/** One account: how it is recognised and what it may do. Never its hash, never its display name. */
export interface SiteAccountDto {
  readonly id: string
  readonly email: string
  readonly siteRole: 'none' | 'operator'
  readonly createdAt: string
  readonly lastLoginAt: string | null
  readonly disabledAt: string | null
  readonly mustChangePassword: boolean
  readonly ownedEventCount: number
  readonly clients: readonly { readonly clientId: string; readonly role: 'owner' | 'member' }[]
  /** The version of the terms the account last accepted, and when: the proof. `null` if none. */
  readonly termsVersion: string | null
  readonly termsAcceptedAt: string | null
}

export interface SiteAccountPageDto {
  readonly items: readonly SiteAccountDto[]
  readonly next: string | null
}

/**
 * One line of the log as the **operator** reads it. Unlike the client's view it names the account
 * behind an `operator` or `member` actor, and it carries `details.reason` where an action has one.
 */
export interface SiteAuditEntryDto {
  readonly seq: number
  readonly at: string
  readonly action: string
  readonly actor: {
    readonly kind: 'operator' | 'member' | 'system' | 'integration'
    readonly userId: string | null
    readonly label: string | null
  }
  readonly subject: { readonly type: string; readonly id: string }
  readonly clientId: string | null
  /** Numbers, switches, instants and, for `client.ceilingsChanged`, the operator's `reason`. */
  readonly details: Readonly<Record<string, unknown>>
}

export interface SiteAuditPageDto {
  readonly items: readonly SiteAuditEntryDto[]
  /** The `before` of the next page, or `null` when this was the last one. */
  readonly next: number | null
}

/**
 * An invitation an operator wrote. **`link` is present only when no mail went out**, which is a
 * fact about the box's relay and never about the address: where a mailer delivers, this answer
 * holds no token and no link. `pendingApproval` says the link opens nothing until an owner of the
 * client has approved it (R1).
 */
export interface OperatorInvitationByMailDto {
  readonly id: string
  readonly delivery: 'mail'
  readonly expiresAt: string
  readonly pendingApproval: boolean
}

export interface OperatorInvitationByLinkDto {
  readonly id: string
  readonly delivery: 'link'
  readonly expiresAt: string
  readonly pendingApproval: boolean
  readonly link: string
}

/** A union, so that `{ delivery: 'mail', link }` is not a value the type can hold. */
export type OperatorInvitationDto = OperatorInvitationByMailDto | OperatorInvitationByLinkDto

export interface ProvisionedClientDto {
  readonly clientId: string
  readonly invitation: OperatorInvitationDto
}

/** What a changed set of ceilings now is, as the console reads it back. */
export interface ClientCeilingsChangedDto {
  readonly ceilings: CeilingsDto
  readonly eventsCreatedInPeriod: number
}

/**
 * What the operator is told of a password reset it asked for (R2). **`mail`** says it went to the
 * account's own mailbox and nothing else. `pendingApproval` carries the id an owner of the
 * account's client is asked to approve, which is not a secret. **`link` exists only** on a box
 * with no mail relay and `copyLinkWithOwnerApproval`, after another owner's approval.
 */
export interface OperatorPasswordResetByMailDto {
  readonly delivery: 'mail'
  readonly expiresAt: string
}

export interface OperatorPasswordResetPendingDto {
  readonly delivery: 'pendingApproval'
  readonly expiresAt: string
  readonly approvalId: string
}

export interface OperatorPasswordResetByLinkDto {
  readonly delivery: 'link'
  readonly expiresAt: string
  readonly link: string
}

/** A union: the link exists in the type only on the variant that is allowed to carry one. */
export type OperatorPasswordResetDto =
  OperatorPasswordResetByMailDto | OperatorPasswordResetPendingDto | OperatorPasswordResetByLinkDto
