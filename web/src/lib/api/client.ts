import { http, type Transport, type UploadProgress } from '../http'
import type {
  BulkModerationResponse,
  EventDto,
  EventSettingsDto,
  EventStatus,
  EventSummaryDto,
  GuestListResponse,
  GuestPhotoDto,
  JoinResponse,
  ModerationDecision,
  ModerationQueueResponse,
  ModeratorDto,
  PhotoStatus,
  ReactionKind,
  ReactionsResponse,
  SessionResponse,
  SessionUserDto,
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
}

export interface UploadInput {
  readonly files: readonly File[]
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
    return transport.upload(`/api/events/${encode(slug)}/photos`, form, {
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  },

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

  rotateJoinCode: (slug: string): Promise<EventDto> =>
    transport.post(`/api/events/${encode(slug)}/join-code`),

  purgeEvent: (slug: string): Promise<void> => transport.del(`/api/events/${encode(slug)}`),

  // -------------------------------------------------------------- moderation --

  moderationQueue: (
    slug: string,
    query: { status?: PhotoStatus | 'all'; cursor?: string; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<ModerationQueueResponse> =>
    transport.get(
      `/api/events/${encode(slug)}/moderation`,
      {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
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
