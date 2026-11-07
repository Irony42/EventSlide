import type { Transport } from '../../http'
import type { Locale } from '../../i18n/locale'
import type {
  ClientAuditPageDto,
  ClientCeilingsChangedDto,
  ClientDefaultsDto,
  OperatorInvitationDto,
  OperatorPasswordResetDto,
  MyLimitsDto,
  PendingInvitationsDto,
  ProvisionedClientDto,
  SiteAccountPageDto,
  SiteAuditPageDto,
  SiteCeilingsPatch,
  SiteClientPageDto,
  SiteEventLookupDto,
  SiteEventPageDto,
  SiteEventStateDto,
  SiteGuestbookStateDto,
  SitePhotoStateDto,
} from '../dto'
import { encode } from './shared'

// The client space and the operator's console (`SITE_ADMIN=on` only).
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
} /** `POST /api/site/clients/:clientId/invitations`: into the client's account, never an event. */
export interface SiteInvitationInput {
  readonly email: string
  readonly role: 'owner' | 'member'
  readonly locale: Locale
} /** `POST /api/site/accounts/:userId/password-reset`. `approvalId` is an id, never a secret. */
export interface SiteResetInput {
  readonly locale: Locale
  readonly approvalId?: string
}
export const siteApi = (transport: Transport) => ({
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

  /**
   * Which event a slug, a join code, an address or an exact name names: ids, a status and two
   * instants, never the name, the slug or the code (launch review S5).
   */
  siteLookupEvents: (query: string, signal?: AbortSignal): Promise<SiteEventLookupDto> =>
    transport.get('/api/site/events/lookup', { q: query }, signal),

  siteEventState: (eventId: string, signal?: AbortSignal): Promise<SiteEventStateDto> =>
    transport.get(`/api/site/events/${encode(eventId)}`, undefined, signal),

  /** Where a photograph is and whether it is down, by its id alone. */
  sitePhotoState: (photoId: string, signal?: AbortSignal): Promise<SitePhotoStateDto> =>
    transport.get(`/api/site/photos/${encode(photoId)}`, undefined, signal),

  /** Where a guestbook message is and whether it is down, by its id alone: never its text. */
  siteGuestbookState: (entryId: string, signal?: AbortSignal): Promise<SiteGuestbookStateDto> =>
    transport.get(`/api/site/guestbook-entries/${encode(entryId)}`, undefined, signal),

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

  // The remove-without-viewing levers (launch review S5): by id, with a **mandatory** reason of at
  // most 200 characters on one line. Every one is a write, behind a fresh step-up.
  siteTakeDownPhoto: (photoId: string, reason: string): Promise<void> =>
    transport.post(`/api/site/photos/${encode(photoId)}/take-down`, { reason }),

  siteRestorePhoto: (photoId: string, reason: string): Promise<void> =>
    transport.post(`/api/site/photos/${encode(photoId)}/restore`, { reason }),

  siteTakeDownGuestbookEntry: (entryId: string, reason: string): Promise<void> =>
    transport.post(`/api/site/guestbook-entries/${encode(entryId)}/take-down`, { reason }),

  siteRestoreGuestbookEntry: (entryId: string, reason: string): Promise<void> =>
    transport.post(`/api/site/guestbook-entries/${encode(entryId)}/restore`, { reason }),

  siteTakeDownEvent: (eventId: string, reason: string): Promise<void> =>
    transport.post(`/api/site/events/${encode(eventId)}/take-down`, { reason }),

  siteRestoreEvent: (eventId: string, reason: string): Promise<void> =>
    transport.post(`/api/site/events/${encode(eventId)}/restore`, { reason }),

  siteHoldEventPurge: (eventId: string, reason: string): Promise<void> =>
    transport.post(`/api/site/events/${encode(eventId)}/purge-hold`, { reason }),

  siteReleaseEventPurge: (eventId: string, reason: string): Promise<void> =>
    transport.post(`/api/site/events/${encode(eventId)}/purge-release`, { reason }),

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
})
