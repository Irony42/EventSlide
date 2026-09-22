import { http, type Transport, type UploadProgress } from '../http'
import type {
  BulkModerationResponse,
  ClipJobDto,
  EventDto,
  EventLanguage,
  EventSettingsDto,
  EventStatus,
  EventSummaryDto,
  EventTemplateKey,
  GalleryDto,
  GalleryPage,
  GuestListResponse,
  GuestMissionListResponse,
  GuestPhotoDto,
  JoinResponse,
  MissionDto,
  MissionListResponse,
  MissionScope,
  ModerationDecision,
  ModerationQueueResponse,
  ModeratorDto,
  PhotoStatus,
  ReactionKind,
  ReactionsResponse,
  SessionResponse,
  SessionUserDto,
  ShareLinkCreated,
  ShareLinkResponse,
  TopPhotoDto,
  UploadResponse,
  WallResponse,
} from './dto'

/**
 * One typed function per endpoint in docs/API.md.
 *
 * Built over an injectable `Transport` so a component test can pass a fake and never
 * touch `fetch`. `api` is the real instance the app uses; `createApi(fake)` is what
 * tests use.
 */

const encode = encodeURIComponent

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
}

/**
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
}

export interface UploadInput {
  readonly files: readonly File[]
  readonly caption?: string | null
  /**
   * Which of the host prompts the guest tapped before sending (roadmap 2.1).
   *
   * One per request rather than one per file, exactly as the caption is: a guest picks a
   * mission, then picks their photographs, and asking them to file five files one by one
   * on a phone is asking them not to bother.
   */
  readonly missionId?: string | null
  readonly onProgress?: (progress: UploadProgress) => void
  readonly signal?: AbortSignal
}

/**
 * One clip. Singular, and that is the endpoint's shape rather than this function's.
 *
 * `POST /api/events/:slug/clips` accepts **exactly one** file under the field `clip`;
 * anything else is `LIMIT_UNEXPECTED_FILE` from multer before a line of our code runs.
 * The photo path takes a batch because twenty photographs is an ordinary thing for a
 * guest to have; twenty videos is eight hundred megabytes and a queue nobody drains.
 */
export interface ClipUploadInput {
  readonly file: File
  readonly caption?: string | null
  readonly onProgress?: (progress: UploadProgress) => void
  readonly signal?: AbortSignal
}

/**
 * An invitation, in full.
 *
 * The password is not optional and is not generated here. There is no mail service in
 * this product, so the host is the delivery channel: they type a temporary credential
 * and read it out to the person they are handing the laptop to. The server's
 * `moderatorInvitationBody` is `.strict()` and requires it — an invitation carrying only
 * an address is answered `400 request.invalid`, which is exactly what this panel used to
 * send, every time.
 *
 * An object rather than two positional strings: an address and a password are both
 * `string`, and a call site that swaps them typechecks.
 */
/**
 * One prompt as the host writes it (roadmap §2.1).
 *
 * Both fields every time, on create and on edit alike: they are one decision made on one
 * row of one form, and sending half of it would let a scope be persisted beside a prompt
 * the server refused.
 */
export interface MissionInput {
  readonly prompt: string
  readonly scope: MissionScope
}

/**
 * The host's shared gallery link as they choose it (roadmap §4.1). Both optional, and
 * each sent only when chosen: absent is the server's month and no password, and an empty
 * password field is "no password" rather than a 400.
 */
export interface ShareLinkInput {
  readonly expiresInDays?: number
  readonly password?: string
}

export interface ModeratorInvitationInput {
  readonly email: string
  readonly temporaryPassword: string
}

/**
 * What `POST /api/events/:slug/moderators` answers, as the server presents it.
 *
 * Not a `ModeratorDto`: the response is a 201 carrying `{ userId, created }`, and
 * `created` is the useful half — it says whether the temporary password the host just
 * typed is worth reading out, or whether the address already had an account that keeps
 * its own.
 *
 * Declared here rather than in `dto.ts` because the response envelope of a write is not
 * one of the shapes the wall and the console share.
 */
export interface ModeratorInviteResponse {
  readonly userId: string
  readonly created: boolean
}

export const createApi = (transport: Transport) => ({
  // ------------------------------------------------------------------ public --

  join: (joinCode: string, displayName: string | null): Promise<JoinResponse> =>
    transport.post('/api/join', { joinCode, displayName }),

  /**
   * No query string, on purpose. The display URL's `?layout=` and its `e2e_*` timing
   * hooks are read in the browser (`web/src/features/wall/hooks/`) because they are
   * one screen's presentation choices; forwarding them would ask the server to hold
   * this client's view state for the length of a request, and `wallQuery` is `.strict()`
   * so it answers `400 request.invalid` rather than pretend to.
   */
  wall: (slug: string, signal?: AbortSignal): Promise<WallResponse> =>
    transport.get(`/api/events/${encode(slug)}/wall`, undefined, signal),

  // ------------------------------------------------------------------- guest --

  uploadPhotos: (slug: string, input: UploadInput): Promise<UploadResponse> => {
    const form = new FormData()
    for (const file of input.files) form.append('photos', file)
    // Omitted rather than sent empty: the server distinguishes "no caption" from an
    // invalid one, and an untouched field must not become a validation error.
    if (input.caption !== undefined && input.caption !== null && input.caption !== '') {
      form.append('caption', input.caption)
    }
    // Same shape as the caption above: omitted rather than sent empty, because the
    // server parses this as a uuid and an empty part would be a 400 on an upload that
    // simply had no mission.
    if (input.missionId !== undefined && input.missionId !== null && input.missionId !== '') {
      form.append('missionId', input.missionId)
    }
    return transport.upload(`/api/events/${encode(slug)}/photos`, form, {
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  },

  /**
   * Sends a clip and gets back the **job**, not a photo.
   *
   * `202`, and the status code is the contract: nothing exists yet that a moderator
   * could act on. What comes back is the job to watch and the id of the row it will
   * become — which is why the caller's next move is {@link Api.clipJob} rather than a
   * refetch of "Vos envois", where there is nothing to find for the length of the
   * transcode.
   *
   * A repeat of the same bytes answers `202` with the **same** `clipJobId` rather than
   * queueing a second transcode, so a dropped upload on venue Wi-Fi is safe to send
   * again.
   */
  uploadClip: (slug: string, input: ClipUploadInput): Promise<ClipJobDto> => {
    const form = new FormData()
    form.append('clip', input.file)
    // Omitted rather than sent empty, exactly as the photo path does: the server
    // distinguishes "no caption" from an invalid one.
    if (input.caption !== undefined && input.caption !== null && input.caption !== '') {
      form.append('caption', input.caption)
    }
    return transport.upload(`/api/events/${encode(slug)}/clips`, form, {
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  },

  /**
   * "Where is my clip?" — the one question a guest has while it is transcoding.
   *
   * Answers the same body as the upload. The server sends `Cache-Control: no-store`,
   * because this is the one view whose whole purpose is to change.
   */
  clipJob: (slug: string, clipJobId: string, signal?: AbortSignal): Promise<ClipJobDto> =>
    transport.get(`/api/events/${encode(slug)}/clips/${encode(clipJobId)}`, undefined, signal),

  /**
   * The guest checklist (roadmap 2.1).
   *
   * One read, and one is the requirement rather than an optimisation: the screen that
   * tells a guest there is something to do is fetched on a saturated access point before
   * they have taken a single photograph.
   */
  myMissions: (slug: string, signal?: AbortSignal): Promise<GuestMissionListResponse> =>
    transport.get(`/api/events/${encode(slug)}/missions/mine`, undefined, signal),

  myPhotos: (slug: string, signal?: AbortSignal): Promise<{ items: readonly GuestPhotoDto[] }> =>
    transport.get(`/api/events/${encode(slug)}/photos/mine`, undefined, signal),

  deleteMyPhoto: (slug: string, photoId: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/photos/${encode(photoId)}`),

  setCaption: (slug: string, photoId: string, caption: string | null): Promise<void> =>
    transport.patch(`/api/events/${encode(slug)}/photos/${encode(photoId)}/caption`, { caption }),

  react: (slug: string, photoId: string, kind: ReactionKind): Promise<void> =>
    transport.post(`/api/events/${encode(slug)}/photos/${encode(photoId)}/reactions`, { kind }),

  withdrawReaction: (slug: string, photoId: string, kind: ReactionKind): Promise<void> =>
    transport.del(
      `/api/events/${encode(slug)}/photos/${encode(photoId)}/reactions/${encode(kind)}`,
    ),

  reactions: (slug: string, photoId: string, signal?: AbortSignal): Promise<ReactionsResponse> =>
    transport.get(
      `/api/events/${encode(slug)}/photos/${encode(photoId)}/reactions`,
      undefined,
      signal,
    ),

  // -------------------------------------------------------------------- auth --

  login: (email: string, password: string): Promise<SessionUserDto> =>
    transport.post('/api/auth/login', { email, password }),

  logout: (): Promise<void> => transport.post('/api/auth/logout'),

  session: (signal?: AbortSignal): Promise<SessionResponse> =>
    transport.get('/api/auth/me', undefined, signal),

  changePassword: (currentPassword: string, newPassword: string): Promise<void> =>
    transport.post('/api/auth/password', { currentPassword, newPassword }),

  // ------------------------------------------------------------------ events --

  listEvents: (signal?: AbortSignal): Promise<{ items: readonly EventSummaryDto[] }> =>
    transport.get('/api/events', undefined, signal),

  createEvent: (input: CreateEventInput): Promise<EventDto> => transport.post('/api/events', input),

  getEvent: (slug: string, signal?: AbortSignal): Promise<EventDto> =>
    transport.get(`/api/events/${encode(slug)}`, undefined, signal),

  renameEvent: (slug: string, name: string): Promise<EventDto> =>
    transport.patch(`/api/events/${encode(slug)}`, { name }),

  updateSettings: (slug: string, settings: Partial<EventSettingsDto>): Promise<EventDto> =>
    transport.patch(`/api/events/${encode(slug)}/settings`, settings),

  setEventStatus: (slug: string, status: EventStatus): Promise<EventDto> =>
    transport.post(`/api/events/${encode(slug)}/status`, { status }),

  setSchedule: (slug: string, schedule: EventScheduleInput): Promise<EventDto> =>
    transport.patch(`/api/events/${encode(slug)}/schedule`, schedule),

  rotateJoinCode: (slug: string): Promise<EventDto> =>
    transport.post(`/api/events/${encode(slug)}/join-code`),

  purgeEvent: (slug: string): Promise<void> => transport.del(`/api/events/${encode(slug)}`),

  // -------------------------------------------------------------- moderation --

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

  moderateBulk: (
    slug: string,
    photoIds: readonly string[],
    decision: ModerationDecision,
  ): Promise<BulkModerationResponse> =>
    transport.post(`/api/events/${encode(slug)}/moderation/bulk`, { photoIds, decision }),

  deletePhoto: (slug: string, photoId: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/photos/${encode(photoId)}`),

  topPhotos: (slug: string, signal?: AbortSignal): Promise<{ items: readonly TopPhotoDto[] }> =>
    transport.get(`/api/events/${encode(slug)}/top-photos`, undefined, signal),

  // ------------------------------------------------------------------ guests --

  listGuests: (slug: string, signal?: AbortSignal): Promise<GuestListResponse> =>
    transport.get(`/api/events/${encode(slug)}/guests`, undefined, signal),

  revokeGuest: (slug: string, guestId: string): Promise<void> =>
    transport.post(`/api/events/${encode(slug)}/guests/${encode(guestId)}/revoke`),

  // -------------------------------------------------------------- moderators --

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

  // ---------------------------------------------------------------- missions --

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

  // ---------------------------------------------------------- shared gallery --

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

  /**
   * What a guest holding the link is shown. `401 gallery.passwordRequired` until the
   * password has been entered in this browser; `404 gallery.notAvailable` for a dead link,
   * whatever killed it.
   */
  gallery: (token: string, signal?: AbortSignal): Promise<GalleryDto> =>
    transport.get(`/api/gallery/${encode(token)}`, undefined, signal),

  /**
   * The password, in a body and never in a URL. The answer is an `HttpOnly` cookie this
   * code cannot read, which the two reads beside it then carry.
   */
  unlockGallery: (token: string, password: string): Promise<void> =>
    transport.post(`/api/gallery/${encode(token)}/unlock`, { password }),

  galleryPhotos: (
    token: string,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<GalleryPage> =>
    transport.get(
      `/api/gallery/${encode(token)}/photos`,
      cursor === null ? undefined : { cursor },
      signal,
    ),

  // ------------------------------------------------------------------- links --

  /** Built here so the ZIP link and the wall link cannot drift from the API doc. */
  albumUrl: (slug: string): string => `/api/events/${encode(slug)}/album.zip`,

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

export type Api = ReturnType<typeof createApi>

export const api: Api = createApi(http)
