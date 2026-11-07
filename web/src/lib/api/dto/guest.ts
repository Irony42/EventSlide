// What a guest reads and writes.
import type {
  EventBrandDto,
  EventThemeDto,
  MediaKind,
  MissionScope,
  PhotoStatus,
  ReactionCounts,
  ReactionKind,
} from './common'

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
   * The host's switch over written guestbook messages (spec 01). Optional on the client because a
   * session stored before the upgrade, and an older server, do not send it: absent reads as off.
   */
  readonly allowGuestbook?: boolean
  /** The longest message the server accepts, so the phone states a limit the server owns. */
  readonly guestbookMaxLength?: number
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
  /** The host's welcome message (spec 03). Optional: a server build that predates it sends none. */
  readonly brand?: EventBrandDto
}
/**
 * The privacy notice's three closed vocabularies (roadmap §5.1).
 *
 * Written out again rather than imported, like every type here, and held to the domain's
 * `NOTICE_*` tuples by `src/interface/http/presenters/noticeVocabulary.test.ts`: a
 * member the server can send and this file does not name fails there. Each one keys a copy
 * table in `web/src/lib/i18n/`, so once a member is added here — the shared gallery of
 * roadmap §4.1 is the audience already argued for — the tables refuse to compile until all
 * five languages can say it.
 */
export type NoticePublication = 'afterReview' | 'immediate'
export type NoticeAudience = 'wall' | 'guestFeed' | 'organisers' | 'sharedGallery'
export type NoticeAcknowledgementStatus = 'none' | 'current' | 'outdated'
/**
 * What happens to a guest's photo, as values the server derived from the event's own
 * settings. The client words them; it never decides them — so a notice cannot say
 * "checked before the screen" on an event that publishes on arrival.
 */
export interface PrivacyNoticeDto {
  /** Opaque. Sent back as-is when the guest acknowledges. */
  readonly revision: string
  readonly publication: NoticePublication
  /** Who sees a photo, in the order a guest reads them. */
  readonly audiences: readonly NoticeAudience[]
  /** Days after the gallery closes. `null`: nothing deletes the album on its own. */
  readonly retentionDays: number | null
  /** How long a guest may take a photo back themselves. `null`: they cannot. */
  readonly selfRemovalSeconds: number | null
  /**
   * Who hosts the photo (`OPERATOR_NAME`, roadmap G2-17). Present only when the operator
   * named themselves; part of `revision`, so a guest who read a notice without it is asked
   * to read this one.
   */
  readonly operator?: string
  /** Present only when guests may leave guestbook messages (spec 01): the notice reads for a message too. */
  readonly guestbook?: true
}
/** A notice and where this device stands with it: the answer of every notice route. */
export interface PrivacyNoticeState {
  readonly notice: PrivacyNoticeDto
  readonly acknowledgement: NoticeAcknowledgementStatus
}
export interface JoinResponse {
  readonly guestId: string
  readonly displayName: string | null
  readonly event: PublicEventDto
  /**
   * On the join so the upload screen knows before its first frame whether to show the
   * picker or the notice, with no second round trip on venue Wi-Fi.
   */
  readonly privacyNotice: PrivacyNoticeState
}
/** `duplicate` is a success: the same bytes already exist in this event. */
export type UploadOutcome =
  | { readonly index: number; readonly status: 'accepted'; readonly photoId: string }
  | { readonly index: number; readonly status: 'duplicate'; readonly photoId: string }
  | { readonly index: number; readonly status: 'rejected'; readonly code: string }
export interface UploadResponse {
  readonly results: readonly UploadOutcome[]
}
/**
 * `GET /api/events/:slug/photos/mine`: the guest's own photos, and whether the event still takes
 * more. `acceptingUploads` is absent from a server build that predates it, which reads as `true`:
 * the screen then behaves as it always did and the server's refusal stays the backstop.
 */
export interface MyPhotosDto {
  readonly items: readonly GuestPhotoDto[]
  readonly acceptingUploads?: boolean
  /**
   * The event's look as the server holds it now, which the join's copy may no longer be.
   * Absent from a server build that predates it, and then the stored theme stands.
   */
  readonly theme?: EventThemeDto
  /** The host's welcome message (spec 03). Optional: a server build that predates it sends none. */
  readonly brand?: EventBrandDto
}
/** What `DELETE /api/events/:slug/guests/me` removed. */
export interface ErasedContributionDto {
  readonly photos: number
  readonly clips: number
  /** Guestbook messages removed with them; absent from an older server. */
  readonly messages?: number
}
/** One of the guest's own guestbook messages (spec 01). */
export interface GuestbookEntryDto {
  readonly id: string
  readonly text: string
  readonly status: 'pending' | 'published' | 'rejected' | 'hidden'
  readonly createdAt: string
  /** The server's verdict: the phone never recomputes it. */
  readonly canDelete: boolean
}
export interface MyGuestbookDto {
  readonly items: readonly GuestbookEntryDto[]
  /** Whether a new message would be taken now: the switch, the event's state and the window. */
  readonly accepting: boolean
  /** Whether published messages appear on the wall: said to their authors in the status. */
  readonly onWall: boolean
}
/** What a message just written answers. */
export interface CreatedGuestbookEntryDto {
  readonly id: string
  readonly text: string
  readonly status: 'pending' | 'published' | 'rejected' | 'hidden'
  readonly createdAt: string
  /** True when this was the same message sent a moment ago: nothing new was stored. */
  readonly duplicate: boolean
}
export interface GuestPhotoDto {
  readonly id: string
  readonly status: PhotoStatus
  readonly thumbUrl: string
  readonly caption: string | null
  readonly createdAt: string
  /** Computed server-side from the grace window and the status, so the two never disagree. */
  readonly canDelete: boolean
  /** See `WallItemDto` (wall.ts). `thumbUrl` is the poster when this row is a clip. */
  readonly kind: MediaKind
  readonly videoUrl: string | null
  readonly durationMs: number | null
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
/**
 * The timed challenge as a phone reads it (spec 10). No count of answers: a guest has no use for
 * a scoreboard (roadmap §7). `state` is the server's word; the phone only counts `endsAt` down,
 * against the `serverNowMs` of the same response.
 */
export interface GuestChallengeDto {
  readonly id: string
  /** The mission to preselect, or `null` if it has just been deleted. */
  readonly missionId: string | null
  /** The frozen copy of the prompt: content, never translated. */
  readonly prompt: string
  readonly endsAt: string
  readonly state: 'running' | 'ended'
}
export interface GuestMissionListResponse {
  readonly items: readonly GuestMissionDto[]
  /** The server's clock at this read, in milliseconds (spec 10; the same field as the wall's). */
  readonly serverNowMs?: number
  /** `null` or absent when no challenge runs or one ended more than twenty seconds ago. */
  readonly challenge?: GuestChallengeDto | null
}
export interface ReactionsResponse {
  readonly counts: ReactionCounts
  readonly mine: readonly ReactionKind[]
}
