import { makeOffboardClient } from '../application/usecases/clients/offboardClient'
import { makeFinalizeOffboardedClients } from '../application/usecases/clients/finalizeOffboardedClients'
import { makeIssuePasswordResetForAccount } from '../application/usecases/auth/issuePasswordResetForAccount'
import { makeDeleteEmptyClient } from '../application/usecases/clients/deleteEmptyClient'
import { makeListClients } from '../application/usecases/clients/listClients'
import { makeApproveInvitation } from '../application/usecases/clients/approveInvitation'
import { makeGetClientLimits } from '../application/usecases/clients/getClientLimits'
import { makeListClientAudit } from '../application/usecases/clients/listClientAudit'
import { makeListPendingInvitations } from '../application/usecases/clients/listPendingInvitations'
import { makeApprovePasswordReset } from '../application/usecases/clients/approvePasswordReset'
import { makeInviteToClientAsOperator } from '../application/usecases/clients/inviteToClientAsOperator'
import { makeProvisionClientOwner } from '../application/usecases/clients/provisionClientOwner'
import { makeRenameClient } from '../application/usecases/clients/renameClient'
import { makeResumeClient } from '../application/usecases/clients/resumeClient'
import { makeSetClientCeilings } from '../application/usecases/clients/setClientCeilings'
import { makeSuspendClient } from '../application/usecases/clients/suspendClient'
import { makeGetSiteEventState } from '../application/usecases/site/getSiteEventState'
import { makeGetSiteGuestbookState } from '../application/usecases/site/getSiteGuestbookState'
import { makeGetSitePhotoState } from '../application/usecases/site/getSitePhotoState'
import { makeLookupSiteEvents } from '../application/usecases/site/lookupSiteEvents'
import { makeSetEventPurgeHold } from '../application/usecases/site/setEventPurgeHold'
import { makeSetEventTakedown } from '../application/usecases/site/setEventTakedown'
import { makeSetGuestbookTakedown } from '../application/usecases/site/setGuestbookTakedown'
import { makeSetPhotoTakedown } from '../application/usecases/site/setPhotoTakedown'
import { makeListSiteAccounts } from '../application/usecases/site/listSiteAccounts'
import { makeListSiteAudit } from '../application/usecases/site/listSiteAudit'
import { makeListSiteClientEvents } from '../application/usecases/site/listSiteClientEvents'
import { makeListSiteClients } from '../application/usecases/site/listSiteClients'
import type { Adapters, UseCasePolicy } from './usecases'
import { clientCreator, type SharedHooks } from './usecases.shared'

/** The clients slice of the use-case bag: composition only, built by `buildUseCases`. */
export const clientsUseCases = (
  adapters: Adapters,
  policy: UseCasePolicy,
  { invalidateReel, invalidateBook, issueInvitation }: SharedHooks,
) => ({
  // clients
  //
  // Built whatever `SITE_ADMIN` says, like every use case: the mode decides which routes
  // are mounted (roadmap §10.9), never which use cases exist. The operator's routes call them
  // (`/api/site`, G2-14), behind `SITE_ADMIN` and `requireOperator`. The gate is the HTTP
  // layer's, so the use cases that write the audit log (§10.8) take an actor: an entry must say
  // who did it. `createClient` and `deleteEmptyClient` have no route: the first is what
  // `provisionClientOwner` builds on, and the second only removes the husk of a failed provisioning.
  createClient: clientCreator(adapters),
  /**
   * Opens a client and invites its owner (G2-09 / P3-10), behind `requireOperator` and a
   * step-up in `POST /api/site/clients` (G2-14).
   */
  provisionClientOwner: makeProvisionClientOwner({
    createClient: clientCreator(adapters),
    issueInvitation,
    clients: adapters.clients,
    tokens: adapters.accountTokens,
    newClientDefaults: policy.newClientDefaults,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  /**
   * The operator guard's use cases (G2-12 / P3-14, rules R1 and R2). The owner's two have
   * routes (`POST /api/client/invitations/:id/approve` and
   * `POST /api/client/password-resets/:id/approve`); the operator's two are called by
   * `/api/site/clients/:clientId/invitations` and `/api/site/accounts/:userId/password-reset`
   * (G2-14), behind `requireOperator`, the second factor and a step-up, and each reads the
   * caller's site role itself rather than trust the route to have checked it. They write invitations through the box's one issuer, so the
   * per-address queue is still one queue.
   */
  inviteToClientAsOperator: makeInviteToClientAsOperator({
    users: adapters.users,
    clients: adapters.clients,
    tokens: adapters.accountTokens,
    issueInvitation,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  approveInvitation: makeApproveInvitation({
    users: adapters.users,
    clients: adapters.clients,
    tokens: adapters.accountTokens,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  /**
   * The client's own space, read-only (G2-16 / P3-17): the caller's limits, the log of their
   * own client and what waits for their approval. Mounted only on a box with `SITE_ADMIN=on`,
   * and scoped by the caller's own roster in each use case, never by an id from the request.
   */
  getClientLimits: makeGetClientLimits({ clients: adapters.clients, photos: adapters.photos }),
  listClientAudit: makeListClientAudit({ clients: adapters.clients, audit: adapters.audit }),
  listPendingInvitations: makeListPendingInvitations({
    clients: adapters.clients,
    tokens: adapters.accountTokens,
    clock: adapters.clock,
  }),
  approvePasswordReset: makeApprovePasswordReset({
    users: adapters.users,
    clients: adapters.clients,
    tokens: adapters.accountTokens,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  issuePasswordResetForAccount: makeIssuePasswordResetForAccount({
    users: adapters.users,
    clients: adapters.clients,
    tokens: adapters.accountTokens,
    secrets: adapters.secretTokens,
    mailer: adapters.mailer,
    ids: adapters.ids,
    clock: adapters.clock,
    logger: adapters.logger,
    publicUrl: policy.publicUrl,
    mode: policy.operatorResetLinks,
    audit: adapters.audit,
  }),
  // The operator's reads (G2-14): the read model and the log, and nothing else.
  listSiteClients: makeListSiteClients({ overview: adapters.siteOverview }),
  listSiteClientEvents: makeListSiteClientEvents({ overview: adapters.siteOverview }),
  listSiteAccounts: makeListSiteAccounts({ overview: adapters.siteOverview }),
  listSiteAudit: makeListSiteAudit({ audit: adapters.audit }),
  renameClient: makeRenameClient({
    clients: adapters.clients,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  setClientCeilings: makeSetClientCeilings({
    clients: adapters.clients,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  /**
   * Freezing a client and lifting it (G2-14): `POST /api/site/clients/:clientId/suspend` and
   * `/resume`, behind the operator's gate and a step-up.
   */
  suspendClient: makeSuspendClient({
    clients: adapters.clients,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  /**
   * The operator's "remove without viewing" levers (launch review S5, G8-03): by id, with a
   * mandatory reason, behind the same gate and step-up as a suspension, audited and never in the
   * client's own trail. `/api/site/photos/:photoId/take-down|restore` and
   * `/api/site/events/:eventId/take-down|restore|purge-hold|purge-release`.
   */
  lookupSiteEvents: makeLookupSiteEvents({ events: adapters.events }),
  getSiteEventState: makeGetSiteEventState({ events: adapters.events }),
  getSitePhotoState: makeGetSitePhotoState({ photos: adapters.photos }),
  getSiteGuestbookState: makeGetSiteGuestbookState({ guestbook: adapters.guestbook }),
  setGuestbookTakedown: makeSetGuestbookTakedown({
    guestbook: adapters.guestbook,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  setPhotoTakedown: makeSetPhotoTakedown({
    invalidateReel,
    invalidateBook,
    photos: adapters.photos,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  setEventTakedown: makeSetEventTakedown({
    events: adapters.events,
    audit: adapters.audit,
    bus: adapters.bus,
    clock: adapters.clock,
  }),
  setEventPurgeHold: makeSetEventPurgeHold({
    events: adapters.events,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  resumeClient: makeResumeClient({
    clients: adapters.clients,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  offboardClient: makeOffboardClient({
    clients: adapters.clients,
    events: adapters.events,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  /**
   * The end of an offboarding (G2-14 part 3). Like `pruneAuditLog`, **not reachable from any
   * route**: `src/main/retentionSweeper.ts` is its one caller, after it purged what was due.
   */
  finalizeOffboardedClients: makeFinalizeOffboardedClients({
    clients: adapters.clients,
    users: adapters.users,
    holdings: adapters.accountHoldings,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  listClients: makeListClients({ clients: adapters.clients }),
  deleteEmptyClient: makeDeleteEmptyClient({ clients: adapters.clients }),
})
