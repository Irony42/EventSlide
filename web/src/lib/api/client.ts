import { http, type Transport, type UploadProgress } from '../http'
import type { Locale } from '../i18n/locale'
import type {
  About,
  BulkModerationResponse,
  ClientAuditPageDto,
  ClientCeilingsChangedDto,
  ClientDefaultsDto,
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
  MyPhotosDto,
  InvitationAcceptedDto,
  InvitationPreviewDto,
  JoinResponse,
  MissionDto,
  MissionListResponse,
  MissionScope,
  ModerationDecision,
  ModerationQueueResponse,
  ModeratorDto,
  ModeratorInviteResponse,
  OperatorInvitationDto,
  OperatorPasswordResetDto,
  MyLimitsDto,
  PendingInvitationsDto,
  PhotoStatus,
  PrivacyNoticeState,
  ProvisionedClientDto,
  ReactionKind,
  ReactionsResponse,
  RecoveryCodesDto,
  SecondFactorProof,
  SecondFactorRequiredDto,
  SessionResponse,
  SessionUserDto,
  ShareLinkCreated,
  ShareLinkResponse,
  SiteAccountPageDto,
  SiteAuditPageDto,
  SiteCeilingsPatch,
  SiteClientPageDto,
  SiteEventPageDto,
  TopPhotoDto,
  TotpEnrolmentDto,
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

/** The two halves of a second-factor proof, as the wire names them: one is always absent. */
const codeOf = (proof: SecondFactorProof | undefined): string | undefined =>
  proof !== undefined && 'code' in proof ? proof.code : undefined
const recoveryCodeOf = (proof: SecondFactorProof | undefined): string | undefined =>
  proof !== undefined && 'recoveryCode' in proof ? proof.recoveryCode : undefined

/**
 * `POST /api/site/clients`. `ceilings` is the operator's own: a ceiling it names is kept, `null`
 * included (it lifts the box's `NEW_CLIENT_*` default for this client), and one it leaves out takes
 * the default. `locale` is the language the owner's invitation is written in.
 */
export interface SiteProvisionInput {
  readonly clientName: string
  readonly ownerEmail: string
  readonly locale: Locale
  readonly ceilings?: SiteCeilingsPatch
}

/** `POST /api/site/clients/:clientId/invitations`: into the client's account, never an event. */
export interface SiteInvitationInput {
  readonly email: string
  readonly role: 'owner' | 'member'
  readonly locale: Locale
}

/** `POST /api/site/accounts/:userId/password-reset`. `approvalId` is an id, never a secret. */
export interface SiteResetInput {
  readonly locale: Locale
  readonly approvalId?: string
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

/**
 * What the host's invitation form sends: the address, and the language of the page, which is
 * the language the invitation is mailed in. No password and no name — the person chooses
 * both when they accept (roadmap §10.3).
 */
export interface ModeratorInvitationInput {
  readonly email: string
  readonly locale: Locale
}

/**
 * What accepting an invitation sends (`POST /api/invitations/:token/accept`): a person
 * choosing how to sign in, or — from a session the link is for — nothing at all.
 *
 * Two shapes and no third. The server's body is `.strict()`, so a field that could name an
 * account (an address, an id) is a 400: the account an acceptance attaches is the one in the
 * session, never one the request names.
 *
 * Either may carry `acceptTerms`, the tick of "I accept the terms of use" (G2-20), and **only
 * when the preview said the box asks for terms**: on any other box the key is not sent, so a
 * self-hosted server sees the body it always did. It is a boolean and never a version: the
 * version recorded is the box's own.
 */
export type InvitationAcceptance =
  | {
      readonly kind: 'newAccount'
      readonly displayName: string
      readonly password: string
      readonly acceptTerms?: boolean
    }
  | { readonly kind: 'signedInAccount'; readonly acceptTerms?: boolean }

export const createApi = (transport: Transport) => ({
  // ------------------------------------------------------------------ public --

  /**
   * What this box is, its licence and where its source is. Public, and answered with no
   * session: the footer on every guest and host screen reads it, and it must never be the
   * thing a screen waits for.
   */
  about: (signal?: AbortSignal): Promise<About> => transport.get('/api/about', undefined, signal),

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

  /**
   * The privacy notice in force and whether this device has read it (roadmap §5.1).
   *
   * Asked when the upload screen opens and whenever it comes back into view, because the
   * copy the join left in the session is a snapshot and the host may have changed a
   * setting since.
   */
  privacyNotice: (slug: string, signal?: AbortSignal): Promise<PrivacyNoticeState> =>
    transport.get(`/api/events/${encode(slug)}/privacy-notice`, undefined, signal),

  /**
   * "J'ai compris". The revision is the one the screen showed, sent back as-is; a
   * notice the host changed in the meantime answers `409 privacyNotice.outdated`.
   */
  acknowledgePrivacyNotice: (slug: string, revision: string): Promise<PrivacyNoticeState> =>
    transport.post(`/api/events/${encode(slug)}/privacy-notice/acknowledgement`, { revision }),

  myPhotos: (slug: string, signal?: AbortSignal): Promise<MyPhotosDto> =>
    transport.get(`/api/events/${encode(slug)}/photos/mine`, undefined, signal),

  deleteMyPhoto: (slug: string, photoId: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/photos/${encode(photoId)}`),

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

  /** A session, or — for an account with an authenticator — the request for its second step. */
  login: (email: string, password: string): Promise<SessionUserDto | SecondFactorRequiredDto> =>
    transport.post('/api/auth/login', { email, password }),

  /** The second step of a sign-in: a code from the app, or one recovery code. */
  loginSecondFactor: (proof: SecondFactorProof): Promise<SessionUserDto> =>
    transport.post('/api/auth/login/2fa', {
      code: codeOf(proof),
      recoveryCode: recoveryCodeOf(proof),
    }),

  /** Starts an enrolment. The password again: a cookie alone must not attach a phone. */
  enrollSecondFactor: (password: string): Promise<TotpEnrolmentDto> =>
    transport.post('/api/auth/2fa/enroll', { password }),

  /** Proves the app shows the right code; answers the recovery codes, once. */
  confirmSecondFactor: (code: string): Promise<RecoveryCodesDto> =>
    transport.post('/api/auth/2fa/confirm', { code }),

  /** Confirms the person at the keyboard for five minutes: password, and a code if enrolled. */
  stepUp: (password: string, proof?: SecondFactorProof): Promise<void> =>
    transport.post('/api/auth/step-up', {
      password,
      code: codeOf(proof),
      recoveryCode: recoveryCodeOf(proof),
    }),

  /** Needs a fresh step-up. Replaces every recovery code. */
  regenerateRecoveryCodes: (): Promise<RecoveryCodesDto> =>
    transport.post('/api/auth/2fa/recovery-codes'),

  /** Needs a fresh step-up. Removes the authenticator and its recovery codes. */
  disableSecondFactor: (): Promise<void> => transport.post('/api/auth/2fa/disable'),

  logout: (): Promise<void> => transport.post('/api/auth/logout'),

  session: (signal?: AbortSignal): Promise<SessionResponse> =>
    transport.get('/api/auth/me', undefined, signal),

  /** Erases the signed-in account, behind its password. Only where `SITE_ADMIN=on`; `409 account.holds…` while it owns an event. */
  deleteOwnAccount: (password: string): Promise<void> =>
    transport.post('/api/auth/account/delete', { password }),

  changePassword: (currentPassword: string, newPassword: string): Promise<void> =>
    transport.post('/api/auth/password', { currentPassword, newPassword }),

  /**
   * "Forgot your password?" (G2-08 / P3-09). `202 {}` for **every** address — an account, a
   * stranger, a malformed one — so the page says the same thing whatever was typed; `404
   * feature.unavailable` only on a box that cannot send mail, whatever the address. The
   * locale is the page's, because it is the language the mail is written in.
   */
  requestPasswordReset: (email: string, locale: Locale): Promise<void> =>
    transport.post('/api/auth/password-reset/request', { email, locale }),

  /**
   * The mailed link's token and the password chosen with it. `204`: the password is set and
   * **every session is signed out**, none started. The token travels in the body, never in a
   * URL the client builds. A refused password does not spend the link (`400 password.*`).
   */
  confirmPasswordReset: (token: string, password: string): Promise<void> =>
    transport.post('/api/auth/password-reset/confirm', { token, password }),

  /**
   * Signs out every other session of this account. The caller's own is replaced and stays
   * in, so "sign out everywhere" is this call and then {@link Api.logout}.
   */
  revokeOtherSessions: (): Promise<void> => transport.post('/api/auth/sessions/revoke-others'),

  // ------------------------------------------------------------- invitations --

  /**
   * What the link in front of the reader offers, spending nothing. `404 invitation.notFound`
   * for every dead link alike — unknown, malformed, spent, replaced, expired — and the page
   * says one thing for all of them.
   */
  invitation: (token: string, signal?: AbortSignal): Promise<InvitationPreviewDto> =>
    transport.get(`/api/invitations/${encode(token)}`, undefined, signal),

  /**
   * Accepts it. A new account starts a session in the same answer; a signed-in account
   * sends `{}` and its session is the only thing that names it.
   */
  acceptInvitation: (
    token: string,
    acceptance: InvitationAcceptance,
  ): Promise<InvitationAcceptedDto> =>
    transport.post(`/api/invitations/${encode(token)}/accept`, {
      ...(acceptance.kind === 'newAccount'
        ? { displayName: acceptance.displayName, password: acceptance.password }
        : {}),
      ...(acceptance.acceptTerms === undefined ? {} : { acceptTerms: acceptance.acceptTerms }),
    }),

  // ------------------------------------------------------------ client space --
  //
  // Only on a box with `SITE_ADMIN=on`: with it off these are unknown routes, so a caller reads
  // `features.siteAdmin` from `about` first and never probes them.

  myLimits: (signal?: AbortSignal): Promise<MyLimitsDto> =>
    transport.get('/api/me/limits', undefined, signal),

  clientAudit: (
    query: {
      readonly clientId?: string
      readonly before?: number
      readonly limit?: number
    } = {},
    signal?: AbortSignal,
  ): Promise<ClientAuditPageDto> =>
    transport.get(
      '/api/client/audit',
      { clientId: query.clientId, before: query.before, limit: query.limit },
      signal,
    ),

  pendingInvitations: (clientId?: string, signal?: AbortSignal): Promise<PendingInvitationsDto> =>
    transport.get('/api/client/invitations', { clientId }, signal),

  approveInvitation: (invitationId: string): Promise<void> =>
    transport.post(`/api/client/invitations/${encode(invitationId)}/approve`),

  // --------------------------------------------------------- the operator's console --
  //
  // `/api/site/*` (docs/API.md §1; G2-14), on a box with `SITE_ADMIN=on` and for the operator's
  // own session. **Every write is behind a fresh step-up** (`stepUp` above): a write that meets
  // `403 auth.stepUpRequired` is the console's cue to ask for it and send the same request again.
  // Nothing here reaches `/api/events/*` or `/api/gallery*`: what an operator reads of a client
  // is a shape and a size, and no function below could be handed anything else.

  siteClients: (
    query: { readonly after?: string; readonly limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<SiteClientPageDto> =>
    transport.get('/api/site/clients', { after: query.after, limit: query.limit }, signal),

  siteClientEvents: (
    clientId: string,
    query: { readonly after?: string; readonly limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<SiteEventPageDto> =>
    transport.get(
      `/api/site/clients/${encode(clientId)}/events`,
      { after: query.after, limit: query.limit },
      signal,
    ),

  siteAccounts: (
    query: { readonly after?: string; readonly limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<SiteAccountPageDto> =>
    transport.get('/api/site/accounts', { after: query.after, limit: query.limit }, signal),

  /** The whole log; `before` is a bound (every line older than it), not a pointer. */
  siteAudit: (
    query: {
      readonly clientId?: string
      readonly before?: number
      readonly limit?: number
    } = {},
    signal?: AbortSignal,
  ): Promise<SiteAuditPageDto> =>
    transport.get(
      '/api/site/audit',
      { clientId: query.clientId, before: query.before, limit: query.limit },
      signal,
    ),

  /** What a client is given when the form leaves a ceiling alone: the box's `NEW_CLIENT_*`. */
  siteClientDefaults: (signal?: AbortSignal): Promise<ClientDefaultsDto> =>
    transport.get('/api/site/client-defaults', undefined, signal),

  /**
   * Opens a client with no member and no event, and invites its owner. `ceilings` is the
   * operator's own: a key it names is kept (`null` lifts the box's default), one it leaves
   * out takes the default. `locale` is the language the owner's invitation is written in.
   */
  siteProvisionClient: (input: SiteProvisionInput): Promise<ProvisionedClientDto> =>
    transport.post('/api/site/clients', input),

  siteRenameClient: (clientId: string, name: string): Promise<void> =>
    transport.patch(`/api/site/clients/${encode(clientId)}`, { name }),

  /** A patch, with a reason that is **mandatory** and one line of at most 200 characters. */
  siteSetCeilings: (
    clientId: string,
    ceilings: SiteCeilingsPatch,
    reason: string,
  ): Promise<ClientCeilingsChangedDto> =>
    transport.put(`/api/site/clients/${encode(clientId)}/ceilings`, { ceilings, reason }),

  siteSuspendClient: (clientId: string): Promise<void> =>
    transport.post(`/api/site/clients/${encode(clientId)}/suspend`),

  siteResumeClient: (clientId: string): Promise<void> =>
    transport.post(`/api/site/clients/${encode(clientId)}/resume`),

  /**
   * Ends an engagement: live events are closed, drafts archived, the client suspended, and its
   * albums purged `graceDays` from now (whole days; the range is the server's). Idempotent.
   */
  siteOffboardClient: (clientId: string, graceDays: number): Promise<void> =>
    transport.post(`/api/site/clients/${encode(clientId)}/offboard`, { graceDays }),

  /** Into the client's account, never into an event. `pendingApproval` says an owner must agree. */
  siteInviteToClient: (
    clientId: string,
    input: SiteInvitationInput,
  ): Promise<{ readonly invitation: OperatorInvitationDto }> =>
    transport.post(`/api/site/clients/${encode(clientId)}/invitations`, input),

  /** Switches an account off and ends every session it has. Idempotent; refused for an operator. */
  siteDisableAccount: (userId: string): Promise<void> =>
    transport.post(`/api/site/accounts/${encode(userId)}/disable`),

  /** Switches it back on; the sessions it had stay ended. */
  siteEnableAccount: (userId: string): Promise<void> =>
    transport.post(`/api/site/accounts/${encode(userId)}/enable`),

  /** An erasure request (GDPR). Refused while the account holds an event, media or a review. */
  siteDeleteAccount: (userId: string): Promise<void> =>
    transport.del(`/api/site/accounts/${encode(userId)}`),

  /**
   * Resets an account's password. Where a mailer delivers the answer holds no link and no token:
   * it went to the account's own address and nowhere else.
   */
  siteResetPassword: (userId: string, input: SiteResetInput): Promise<OperatorPasswordResetDto> =>
    transport.post(`/api/site/accounts/${encode(userId)}/password-reset`, input),

  // ------------------------------------------------------------------ events --

  listEvents: (signal?: AbortSignal): Promise<{ items: readonly EventSummaryDto[] }> =>
    transport.get('/api/events', undefined, signal),

  createEvent: (input: CreateEventInput): Promise<EventDto> => transport.post('/api/events', input),

  getEvent: (slug: string, signal?: AbortSignal): Promise<EventDto> =>
    transport.get(`/api/events/${encode(slug)}`, undefined, signal),

  updateSettings: (slug: string, settings: Partial<EventSettingsDto>): Promise<EventDto> =>
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
