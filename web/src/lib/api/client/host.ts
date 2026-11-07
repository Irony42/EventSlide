import type { Transport } from '../../http'
import type { Locale } from '../../i18n/locale'
import type {
  BulkModerationResponse,
  EventBrandDto,
  EventDto,
  EventSettingsDto,
  EventThemeDto,
  EventLanguage,
  EventStatus,
  EventSummaryDto,
  EventTemplateKey,
  EventStatsResponse,
  GuestListResponse,
  ChallengeDto,
  HostChallengeResponse,
  GuestbookQueueDto,
  MissionDto,
  MissionListResponse,
  MissionScope,
  AlbumBookDto,
  HighlightsDto,
  ReelDto,
  ModerationDecision,
  ModerationQueueResponse,
  ModeratorDto,
  PreselectHighlightsResponse,
  ModeratorInviteResponse,
  PhotoStatus,
  ShareLinkCreated,
  ShareLinkResponse,
  TopPhotoDto,
} from '../dto'
import { encode } from './shared'

// What the event's host and moderators call, with the links the console builds.
/**
 * What `PATCH /settings` takes: the settings as read, plus the welcome message at the top level
 * (the `brand` block of the read side is read-only and ignored by the server).
 */
export interface EventSettingsPatch {
  readonly moderation?: EventSettingsDto['moderation']
  readonly allowCaptions?: boolean
  readonly allowReactions?: boolean
  readonly allowClips?: boolean
  readonly guestbookOnWall?: boolean
  readonly allowGuestSelfDelete?: boolean
  readonly guestSelfDeleteGraceSeconds?: number
  readonly retentionDays?: number | null
  readonly maxPhotosPerGuest?: number | null
  /** Only the keys changed (spec 13): the server merges the group per key. */
  readonly wall?: Partial<EventSettingsDto['wall']>
  readonly theme?: EventThemeDto
  readonly brand?: EventBrandDto
  readonly wallLanguage?: EventSettingsDto['wallLanguage']
  readonly welcomeMessage?: string | null
}

export interface CreateEventInput {
  readonly name: string
  readonly slug?: string
  readonly startsAt?: string | null
  readonly quotaBytes?: number | null
  /**
   * The preset the event's settings start from (roadmap 3.5), or absent for the product
   * defaults.
   *
   * Optional and never `null`, unlike the two fields above it: those spell "no limit" and
   * "no printed start", and this one has no such value to spell. Absent is the only way
   * to say "no template", and it is what the server's schema accepts.
   */
  readonly template?: EventTemplateKey
  /**
   * The language the event's projected wall will speak (roadmap 1.5).
   *
   * Sent by the create form as the language its host was reading at that moment — the one
   * signal anyone has about a screen nobody will be holding. It is a **snapshot**: nothing
   * re-reads the host's preference afterwards, so switching their own browser to English
   * next month does not move a projector in a room.
   *
   * Optional, like `template`, and absent means the product default rather than any tag.
   */
  readonly wallLanguage?: EventLanguage
} /**
 * The scheduled opening and closing, as ISO-8601 instants with an offset.
 *
 * Both halves travel every time, `null` meaning "the host does this one by hand".
 * Nothing on the wire carries a wall-clock time or a timezone: the host picks a local
 * time in a `datetime-local` field, the browser resolves it against its own zone — the
 * laptop is at the venue — and only the instant is sent.
 */
export interface EventScheduleInput {
  readonly scheduledOpenAt: string | null
  readonly scheduledCloseAt: string | null
} /**
 * One prompt as the host writes it (roadmap §2.1).
 *
 * Both fields every time, on create and on edit alike: they are one decision made on one
 * row of one form, and sending half of it would let a scope be persisted beside a prompt
 * the server refused.
 */
export interface MissionInput {
  readonly prompt: string
  readonly scope: MissionScope
} /** A timed photo challenge as the host launches it (spec 10). */
export interface ChallengeInput {
  /** The challenge's own text (spec 18): one line, 60 characters at most. */
  readonly prompt: string
  /** The mission it was taken from, if the host chose it there; only a link. */
  readonly missionId?: string
  readonly durationSeconds: number
} /**
 * The host's shared gallery link as they choose it (roadmap §4.1). Both optional, and
 * each sent only when chosen: absent is the server's month and no password, and an empty
 * password field is "no password" rather than a 400.
 */
export interface ShareLinkInput {
  readonly expiresInDays?: number
  readonly password?: string
} /**
 * What the host's invitation form sends: the address, and the language of the page, which is
 * the language the invitation is mailed in. No password and no name — the person chooses
 * both when they accept (roadmap §10.3).
 */
/** What the host chose in the book form. */
export interface AlbumBookInput {
  readonly title: string
  readonly subtitle: string
  readonly layout: 'one' | 'four'
  readonly showAuthors: boolean
  readonly showCaptions: boolean
}

export interface ModeratorInvitationInput {
  readonly email: string
  readonly locale: Locale
}

export const hostApi = (transport: Transport) => ({
  listEvents: (signal?: AbortSignal): Promise<{ items: readonly EventSummaryDto[] }> =>
    transport.get('/api/events', undefined, signal),

  createEvent: (input: CreateEventInput): Promise<EventDto> => transport.post('/api/events', input),

  getEvent: (slug: string, signal?: AbortSignal): Promise<EventDto> =>
    transport.get(`/api/events/${encode(slug)}`, undefined, signal),

  updateSettings: (slug: string, settings: EventSettingsPatch): Promise<EventDto> =>
    transport.patch(`/api/events/${encode(slug)}/settings`, settings),

  /**
   * Puts up, or replaces, the host's own photograph of their venue (ADR 0010, decision 8).
   *
   * A multipart `PUT` with one part, `photo`, and answers the event: its theme now carries the
   * photograph's URL. Over `fetch` and not `upload`, which is a guest's `POST` with progress: this
   * file is one phone photograph, and the CSRF retry the plain transport has is worth more here
   * than a progress bar. The name and type the browser attaches are the server's to ignore.
   */
  putVenuePhoto: (slug: string, file: File): Promise<EventDto> => {
    const form = new FormData()
    form.append('photo', file)
    return transport.put(`/api/events/${encode(slug)}/venue-photo`, form)
  },

  /** Takes it down: the ambiance shows its bundled ground again. Idempotent. */
  removeVenuePhoto: (slug: string): Promise<EventDto> =>
    transport.del(`/api/events/${encode(slug)}/venue-photo`),

  /**
   * Sends, or replaces, the event's logo (spec 03): a multipart `PUT` with one part, `file`, that
   * answers the event, whose `brand.logoUrl` is then the stored file. The name and type the browser
   * attaches are the server's to ignore; the format is identified from the bytes.
   */
  putEventLogo: (slug: string, file: File): Promise<EventDto> => {
    const form = new FormData()
    form.append('file', file)
    return transport.put(`/api/events/${encode(slug)}/logo`, form)
  },

  /** Takes the logo down. Idempotent. */
  removeEventLogo: (slug: string): Promise<EventDto> =>
    transport.del(`/api/events/${encode(slug)}/logo`),

  setEventStatus: (slug: string, status: EventStatus): Promise<EventDto> =>
    transport.post(`/api/events/${encode(slug)}/status`, { status }),

  setSchedule: (slug: string, schedule: EventScheduleInput): Promise<EventDto> =>
    transport.patch(`/api/events/${encode(slug)}/schedule`, schedule),

  rotateJoinCode: (slug: string): Promise<EventDto> =>
    transport.post(`/api/events/${encode(slug)}/join-code`),

  purgeEvent: (slug: string): Promise<void> => transport.del(`/api/events/${encode(slug)}`),

  /**
   * No `cursor`, deliberately: the queue answers `nextCursor: null` and cannot be
   * cursor-paged — the ordering is applied to the whole filtered set before `limit`, so
   * there is no stable position to resume from. `moderationQueueQuery` refuses one, so
   * sending it would be a 400 for the whole request. The paged surface is the gallery.
   */
  moderationQueue: (
    slug: string,
    query: { status?: PhotoStatus | 'all'; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<ModerationQueueResponse> =>
    transport.get(
      `/api/events/${encode(slug)}/moderation`,
      {
        ...(query.status ? { status: query.status } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      },
      signal,
    ),

  moderate: (slug: string, photoId: string, decision: ModerationDecision): Promise<void> =>
    transport.patch(`/api/events/${encode(slug)}/photos/${encode(photoId)}/status`, { decision }),

  /** The host's reading of the guestbook: pending first. No cursor (a book is bounded at 500). */
  guestbookQueue: (
    slug: string,
    signal?: AbortSignal,
    query: { status?: PhotoStatus | 'all'; limit?: number } = {},
  ): Promise<GuestbookQueueDto> =>
    transport.get(
      `/api/events/${encode(slug)}/guestbook`,
      {
        ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
        limit: query.limit ?? 500,
      },
      signal,
    ),

  decideGuestbookEntry: (
    slug: string,
    entryId: string,
    decision: ModerationDecision,
  ): Promise<void> =>
    transport.patch(`/api/events/${encode(slug)}/guestbook/${encode(entryId)}/status`, {
      decision,
    }),

  moderateBulk: (
    slug: string,
    photoIds: readonly string[],
    decision: ModerationDecision,
  ): Promise<BulkModerationResponse> =>
    transport.post(`/api/events/${encode(slug)}/moderation/bulk`, { photoIds, decision }),

  /** Stars a published photo as a favourite (spec 08). Idempotent. */
  highlightPhoto: (slug: string, photoId: string): Promise<void> =>
    transport.put(`/api/events/${encode(slug)}/photos/${encode(photoId)}/highlight`),

  unhighlightPhoto: (slug: string, photoId: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/photos/${encode(photoId)}/highlight`),

  /** Stars the `limit` most liked photos; never removes a star. */
  preselectHighlights: (slug: string, limit: number): Promise<PreselectHighlightsResponse> =>
    transport.post(`/api/events/${encode(slug)}/highlights/preselect`, { limit }),

  /** The photo book (spec 04): its state, a request for one, and throwing it away. */
  albumBook: (slug: string, signal?: AbortSignal): Promise<AlbumBookDto> =>
    transport.get(`/api/events/${encode(slug)}/book`, undefined, signal),

  requestAlbumBook: (slug: string, body: AlbumBookInput): Promise<AlbumBookDto> =>
    transport.post(`/api/events/${encode(slug)}/book`, body),

  deleteAlbumBook: (slug: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/book`),

  highlights: (slug: string, signal?: AbortSignal): Promise<HighlightsDto> =>
    transport.get(`/api/events/${encode(slug)}/highlights`, undefined, signal),

  /** Asks for the montage of the favourites (spec 08): `202`, then the panel reads its state. */
  requestReel: (slug: string): Promise<ReelDto> =>
    transport.post(`/api/events/${encode(slug)}/highlights/reel`),

  topPhotos: (slug: string, signal?: AbortSignal): Promise<{ items: readonly TopPhotoDto[] }> =>
    transport.get(`/api/events/${encode(slug)}/top-photos`, undefined, signal),

  listGuests: (slug: string, signal?: AbortSignal): Promise<GuestListResponse> =>
    transport.get(`/api/events/${encode(slug)}/guests`, undefined, signal),

  /** The host statistics page: derived figures, read again as the evening goes on (spec 05). */
  getEventStats: (slug: string, signal?: AbortSignal): Promise<EventStatsResponse> =>
    transport.get(`/api/events/${encode(slug)}/stats`, undefined, signal),

  revokeGuest: (slug: string, guestId: string): Promise<void> =>
    transport.post(`/api/events/${encode(slug)}/guests/${encode(guestId)}/revoke`),

  listModerators: (
    slug: string,
    signal?: AbortSignal,
  ): Promise<{ items: readonly ModeratorDto[] }> =>
    transport.get(`/api/events/${encode(slug)}/moderators`, undefined, signal),

  inviteModerator: (
    slug: string,
    input: ModeratorInvitationInput,
  ): Promise<ModeratorInviteResponse> =>
    transport.post(`/api/events/${encode(slug)}/moderators`, input),

  revokeModerator: (slug: string, userId: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/moderators/${encode(userId)}`),

  /**
   * The host's list, with how the room is answering it (roadmap §2.1).
   *
   * No paging: `MAX_MISSIONS_PER_EVENT` is twelve, so the whole list is the page.
   */
  listMissions: (slug: string, signal?: AbortSignal): Promise<MissionListResponse> =>
    transport.get(`/api/events/${encode(slug)}/missions`, undefined, signal),

  createMission: (slug: string, input: MissionInput): Promise<MissionDto> =>
    transport.post(`/api/events/${encode(slug)}/missions`, input),

  /**
   * Both fields every time, and it answers `204`.
   *
   * A prompt and who it is asked of are one decision on one row of one form. The server
   * returns nothing because an edit touches no photograph and therefore has no reason to
   * re-count them — padding the answer with zeros would put a false number on the wire.
   * The caller refetches the list, which it is doing anyway on the `mission.changed`
   * signal this edit publishes.
   */
  updateMission: (slug: string, missionId: string, input: MissionInput): Promise<void> =>
    transport.patch(`/api/events/${encode(slug)}/missions/${encode(missionId)}`, input),

  /** Removes the prompt. Every photograph filed under it stays, unfiled. */
  deleteMission: (slug: string, missionId: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/missions/${encode(missionId)}`),

  /** What the console draws "Lancer" or "Arrêter" from: the running challenge, and the server's clock. */
  getChallenge: (slug: string, signal?: AbortSignal): Promise<HostChallengeResponse> =>
    transport.get(`/api/events/${encode(slug)}/challenge`, undefined, signal),

  /** Launches one of the event's missions for `durationSeconds` (15 to 1800). A moderator's. */
  startChallenge: (slug: string, input: ChallengeInput): Promise<ChallengeDto> =>
    transport.post(`/api/events/${encode(slug)}/challenge`, input),

  /** Stops the running challenge; `204` with nothing running, too. */
  stopChallenge: (slug: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/challenge`),

  /** The host's link: its status, never its address, which is not stored. */
  shareLink: (slug: string, signal?: AbortSignal): Promise<ShareLinkResponse> =>
    transport.get(`/api/events/${encode(slug)}/share-link`, undefined, signal),

  /** A new link, replacing the current one. The answer carries the address, once. */
  createShareLink: (slug: string, input: ShareLinkInput): Promise<ShareLinkCreated> =>
    transport.post(`/api/events/${encode(slug)}/share-link`, {
      ...(input.expiresInDays === undefined ? {} : { expiresInDays: input.expiresInDays }),
      ...(input.password === undefined || input.password === ''
        ? {}
        : { password: input.password }),
    }),

  revokeShareLink: (slug: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/share-link`),

  /** Built here so the ZIP link and the wall link cannot drift from the API doc. */
  albumUrl: (slug: string): string => `/api/events/${encode(slug)}/album.zip`,

  /** The finished photo book (spec 04). */
  albumBookUrl: (slug: string): string => `/api/events/${encode(slug)}/book.pdf`,

  /** The favourites as a ZIP (spec 08). */
  /** The finished montage, streamed with `Range`; every request is re-checked by the server. */
  reelUrl: (slug: string): string => `/api/events/${encode(slug)}/highlights/reel.mp4`,

  bestOfUrl: (slug: string): string => `/api/events/${encode(slug)}/best-of.zip`,

  /** The wall's channel. Public, because a projector has nobody to sign it in. */
  streamUrl: (slug: string): string => `/api/events/${encode(slug)}/stream`,

  /**
   * The console's channel. Same frames, `requireRole('moderator')` in front of them.
   *
   * Distinct from `streamUrl` on purpose, and not an alias for it. The console used to
   * open the public one: nothing looked broken, because the frames are identical — but a
   * screen that decides what reaches the room was holding an unauthenticated connection
   * to the one endpoint whose authorised twin exists precisely to avoid that. The two
   * will stop being identical the day moderation has to see rejected photos.
   */
  moderationStreamUrl: (slug: string): string => `/api/events/${encode(slug)}/moderation/stream`,
})
