import { Router, type Request, type Response } from 'express'
import type { ClientCeilingsInput } from '../../../domain/clients/clientCeilings'
import { DomainError } from '../../../domain/shared/errors'
import {
  asAccountTokenId,
  asClientId,
  asEventId,
  asUserId,
  type UserId,
} from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireOperator, requireSecondFactor, requireStepUp } from '../middleware/authz'
import { toClientDefaultsDto } from '../presenters/clientDefaultsPresenter'
import {
  toClientCeilingsChangedDto,
  toOperatorInvitationDto,
  toOperatorPasswordResetDto,
  toProvisionedClientDto,
  toSiteAccountPageDto,
  toSiteAuditPageDto,
  toSiteClientPageDto,
  toSiteEventPageDto,
} from '../presenters/siteOverviewPresenter'
import { sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import {
  accountIdParams,
  type CeilingsBody,
  clientIdParams,
  operatorInvitationBody,
  operatorPasswordResetBody,
  provisionClientBody,
  renameClientBody,
  setCeilingsBody,
  siteAccountsQuery,
  siteAuditQuery,
  siteClientEventsQuery,
  siteClientsQuery,
} from '../schemas/siteSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The operator's own namespace: `/api/site/*` (docs/ROADMAP.md §10.9; free plan G2-14, paid plan
 * P3-13).
 *
 * **The gate belongs to the namespace, not to a route.** `requireOperator` is applied
 * with `router.use`, ahead of anything this router will ever carry, so a route added here
 * is behind it the day it is written, whether or not its author remembered the gate
 * exists. The alternative — one `requireOperator` per route, the way `requireRole` is
 * written on the event routes — is a rule every future author has to restate, and the
 * route that forgets it is the one that hands a client list to anybody signed in.
 *
 * **What it carries.** What an operator reads of the box, **content-free** (`SiteOverview`, roadmap
 * §10.4): the clients with their ceilings and what they use, one client's events as shapes and
 * sizes, the accounts, and the audit log. And what an operator does to a client and its owner:
 * open a client and invite its owner, rename it, change its ceilings (with a reason), invite
 * somebody into it, and reset an account's password. Every one of the writes is `requireStepUp`
 * (G2-13): the person at the keyboard confirmed with their password, and a fresh code where the box
 * has one, within the last five minutes. **That is stricter than the plan's table**, which puts the
 * step-up on the irreversible acts only; a console that has to prompt once before a session of
 * writes is the cheaper side of that trade, and a route that writes with a stolen session cookie
 * is the dearer.
 *
 * **The operator guard is the use cases', not this file's** (R1, R2: SECURITY.md §20). An
 * invitation into a client with an event or a member waits for an owner, a reset is mailed and
 * never shown, and each of those use cases reads the caller's site role from storage itself. What
 * this router must not do is get round them: **no answer here carries a token or a link where a
 * mailer delivered**, and the sweep in `siteRoutes.escalation.test.ts` holds that after every
 * mutation, together with "the operator, and anybody it invited without an approval, is a stranger
 * to every event of the client".
 *
 * What this router may **not** do is reach into anybody's event. `requireOperator` grants
 * the box, never an evening — see `middleware/authz.ts` — and a handler here that read a
 * photograph or a moderation queue would be §10.6's support access without its time-box,
 * its announcement or its audit trail. It reads no `EventRepository`: it is handed nine use
 * cases (`SiteRouteDeps`), and the ones it calls take a client's id, an account's id and a read
 * model that has no content in it.
 *
 * An operator whose request matches none of the routes falls through: `requireOperator` calls
 * `next()`, this router has nothing to match, and `buildServer`'s `apiNotFound` answers
 * `404 route.notFound` exactly as it would anywhere else under `/api`.
 *
 * Whether the router exists at all is `buildServer`'s decision, from `SITE_ADMIN`; nothing
 * in here reads the switch, because nothing in here needs to.
 */

/**
 * What the operator's router is handed: the gates' own dependencies, and **the eleven use cases it
 * calls and no others**. It is not given the whole bag, so a handler that reached for
 * `getEventBySlug`, a moderation queue or a photograph would not compile; `deps` is there for
 * `requireOperator` and its siblings, and no handler here reads `deps.events`.
 */
export interface SiteRouteDeps extends Pick<RouteDeps, 'deps'> {
  readonly usecases: Pick<
    HttpUseCases,
    | 'listSiteClients'
    | 'listSiteClientEvents'
    | 'listSiteAccounts'
    | 'listSiteAudit'
    | 'provisionClientOwner'
    | 'renameClient'
    | 'setClientCeilings'
    | 'suspendClient'
    | 'resumeClient'
    | 'inviteToClientAsOperator'
    | 'issuePasswordResetForAccount'
  >
}

/** The operator behind the request. `requireOperator` always populates it. */
const operatorOf = (req: Request, res: Response): UserId | null => {
  const user = req.context.user
  if (user === undefined) {
    sendError(res, DomainError.unauthenticated('auth.required'))
    return null
  }
  return user.userId
}

/**
 * A ceilings patch as the use case reads it: **a key the body did not carry is absent**, not
 * `undefined`, because an absent key keeps the client's value and an explicit `null` removes the
 * ceiling. Written key by key so that a tenth ceiling is a decision here and not a field the
 * parser quietly dropped (`ClientCeilingsProps` would refuse the typo at compile time).
 */
const ceilingsPatchOf = (body: CeilingsBody): ClientCeilingsInput => ({
  ...(body.maxEvents === undefined ? {} : { maxEvents: body.maxEvents }),
  ...(body.maxTotalBytes === undefined ? {} : { maxTotalBytes: body.maxTotalBytes }),
  ...(body.maxEventQuotaBytes === undefined ? {} : { maxEventQuotaBytes: body.maxEventQuotaBytes }),
  ...(body.maxRetentionDays === undefined ? {} : { maxRetentionDays: body.maxRetentionDays }),
  ...(body.clipsAllowed === undefined ? {} : { clipsAllowed: body.clipsAllowed }),
  ...(body.liveAllowed === undefined ? {} : { liveAllowed: body.liveAllowed }),
  ...(body.maxLiveDays === undefined ? {} : { maxLiveDays: body.maxLiveDays }),
  ...(body.maxEventsPerPeriod === undefined ? {} : { maxEventsPerPeriod: body.maxEventsPerPeriod }),
  ...(body.periodStartedAt === undefined ? {} : { periodStartedAt: body.periodStartedAt }),
})

export const siteRoutes = ({ deps, usecases }: SiteRouteDeps): Router => {
  const router = Router()

  // First, and for every method and every path under the mount point. Nothing may be
  // registered above this line.
  router.use(requireOperator(deps))

  // Second, and only for an operator: on a box with `REQUIRE_OPERATOR_2FA` a session that has not
  // passed the second factor reaches nothing below (G2-13 / P3-15). After `requireOperator` so a
  // stranger is told `auth.forbidden` and nothing about second factors. Off, it does nothing.
  router.use(requireSecondFactor(deps))

  /**
   * The ceilings a new client starts with (`NEW_CLIENT_*`, G2-18), for the console to pre-fill
   * the form that provisions one. **Configuration, not content**: it names no client, no event
   * and no account, and reads nothing from storage. `no-store`, because it describes the
   * instance's policy to whoever is signed in and a shared cache has no business holding it.
   */
  router.get('/client-defaults', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(toClientDefaultsDto(deps.config.newClientCeilings))
  })

  // ------------------------------------------------------------------------ reads --
  //
  // Every read is `no-store`: what an operator sees of the box moves with every upload and is
  // nobody's to keep in a shared cache.

  /** Every client with its ceilings and what it uses, newest first. */
  router.get(
    '/clients',
    asyncHandler(async (req, res) => {
      const query = siteClientsQuery.parse(req.query)

      const result = await usecases.listSiteClients({
        ...(query.after === undefined ? {} : { after: asClientId(query.after) }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, page) => sendJson(response, toSiteClientPageDto(page)))
    }),
  )

  /** One client's events, as shapes and sizes: never a name, a slug, a join code or a photograph. */
  router.get(
    '/clients/:clientId/events',
    asyncHandler(async (req, res) => {
      const params = clientIdParams.parse(req.params)
      const query = siteClientEventsQuery.parse(req.query)

      const result = await usecases.listSiteClientEvents({
        clientId: asClientId(params.clientId),
        ...(query.after === undefined ? {} : { after: asEventId(query.after) }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, page) => sendJson(response, toSiteEventPageDto(page)))
    }),
  )

  /** Every account: its address, whether it may sign in, what it belongs to. Never its hash. */
  router.get(
    '/accounts',
    asyncHandler(async (req, res) => {
      const query = siteAccountsQuery.parse(req.query)

      const result = await usecases.listSiteAccounts({
        ...(query.after === undefined ? {} : { after: asUserId(query.after) }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, page) => sendJson(response, toSiteAccountPageDto(page)))
    }),
  )

  /** The audit log: the whole box, or one client's with `clientId`. */
  router.get(
    '/audit',
    asyncHandler(async (req, res) => {
      const query = siteAuditQuery.parse(req.query)

      const result = await usecases.listSiteAudit({
        ...(query.clientId === undefined ? {} : { clientId: asClientId(query.clientId) }),
        ...(query.before === undefined ? {} : { before: query.before }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, page) => sendJson(response, toSiteAuditPageDto(page)))
    }),
  )

  // ----------------------------------------------------------------------- writes --
  //
  // `requireStepUp` first on every one, so a session that has not confirmed is told so before
  // its body is read, and a body is never parsed for a caller who may not send it.

  /**
   * Opens a client and invites its owner (`provisionClientOwner`). The client is created with no
   * member and no event, and its owner arrives by a link that opens an account only once accepted.
   * The answer carries that link **only when no mail went out**; where a mailer delivers it holds
   * an id and a date.
   */
  router.post(
    '/clients',
    requireStepUp(deps),
    asyncHandler(async (req, res) => {
      const operator = operatorOf(req, res)
      if (operator === null) return
      const body = provisionClientBody.parse(req.body)

      const result = await usecases.provisionClientOwner({
        clientName: body.clientName,
        ownerEmail: body.ownerEmail,
        locale: body.locale,
        ...(body.ceilings === undefined ? {} : { ceilings: ceilingsPatchOf(body.ceilings) }),
        createdBy: operator,
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, provisioned) =>
        sendJson(response, toProvisionedClientDto(provisioned), 201),
      )
    }),
  )

  /** Renames a client. `client.renamed` is written, and names neither the old name nor the new. */
  router.patch(
    '/clients/:clientId',
    requireStepUp(deps),
    asyncHandler(async (req, res) => {
      const operator = operatorOf(req, res)
      if (operator === null) return
      const params = clientIdParams.parse(req.params)
      const body = renameClientBody.parse(req.body)

      const result = await usecases.renameClient({
        clientId: asClientId(params.clientId),
        name: body.name,
        actor: { kind: 'operator', userId: operator },
      })

      sendResultNoContent(res, result)
    }),
  )

  /**
   * Changes what a client may do. **The reason is mandatory**: without one the answer is `400`
   * and nothing is read or written. A patch, not a replacement: a key left out keeps the client's
   * value and an explicit `null` removes that ceiling.
   */
  router.put(
    '/clients/:clientId/ceilings',
    requireStepUp(deps),
    asyncHandler(async (req, res) => {
      const operator = operatorOf(req, res)
      if (operator === null) return
      const params = clientIdParams.parse(req.params)
      const body = setCeilingsBody.parse(req.body)

      const result = await usecases.setClientCeilings({
        clientId: asClientId(params.clientId),
        ceilings: ceilingsPatchOf(body.ceilings),
        reason: body.reason,
        actor: { kind: 'operator', userId: operator },
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, client) =>
        sendJson(response, toClientCeilingsChangedDto(client)),
      )
    }),
  )

  /**
   * Freezes a client (roadmap §10.7). Its public surfaces answer as an unknown event does, its
   * members may read and may not write, and an open live feed closes at its next heartbeat. No
   * account is disabled and no medium is touched, so `resume` restores exactly what was there.
   * Idempotent: `204` also for a client that is already suspended, and one line only.
   */
  router.post(
    '/clients/:clientId/suspend',
    requireStepUp(deps),
    asyncHandler(async (req, res) => {
      const operator = operatorOf(req, res)
      if (operator === null) return
      const params = clientIdParams.parse(req.params)

      const result = await usecases.suspendClient({
        clientId: asClientId(params.clientId),
        actor: { kind: 'operator', userId: operator },
      })

      sendResultNoContent(res, result)
    }),
  )

  /** Lifts a suspension. Idempotent, like `suspend`. */
  router.post(
    '/clients/:clientId/resume',
    requireStepUp(deps),
    asyncHandler(async (req, res) => {
      const operator = operatorOf(req, res)
      if (operator === null) return
      const params = clientIdParams.parse(req.params)

      const result = await usecases.resumeClient({
        clientId: asClientId(params.clientId),
        actor: { kind: 'operator', userId: operator },
      })

      sendResultNoContent(res, result)
    }),
  )

  /**
   * Invites somebody into a client's account (the operator guard's **R1**). Into a client that has
   * an event or a member the invitation is written as waiting and opens nothing until one of its
   * owners approves it; the answer says which (`pendingApproval`). The link is in the answer only
   * where no mail went out.
   */
  router.post(
    '/clients/:clientId/invitations',
    requireStepUp(deps),
    asyncHandler(async (req, res) => {
      const operator = operatorOf(req, res)
      if (operator === null) return
      const params = clientIdParams.parse(req.params)
      const body = operatorInvitationBody.parse(req.body)

      const result = await usecases.inviteToClientAsOperator({
        actorId: operator,
        clientId: asClientId(params.clientId),
        email: body.email,
        role: body.role,
        locale: body.locale,
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, invitation) =>
        sendJson(response, { invitation: toOperatorInvitationDto(invitation) }, 201),
      )
    }),
  )

  /**
   * Resets an account's password (the operator guard's **R2**). It is **mailed to the address on
   * record and never shown**: the answer says that it went, and holds no token, no link and no
   * address. A box with no mail relay refuses (`409 reset.mailerRequired`) unless it opted into
   * `copyLinkWithOwnerApproval`, where the first call writes a request another owner of the
   * account's client approves (`POST /api/client/password-resets/:requestId/approve`) and a second,
   * carrying `approvalId`, is the one call in the product that can hand an operator a link.
   */
  router.post(
    '/accounts/:userId/password-reset',
    requireStepUp(deps),
    asyncHandler(async (req, res) => {
      const operator = operatorOf(req, res)
      if (operator === null) return
      const params = accountIdParams.parse(req.params)
      const body = operatorPasswordResetBody.parse(req.body)

      const result = await usecases.issuePasswordResetForAccount({
        actorId: operator,
        userId: asUserId(params.userId),
        locale: body.locale,
        ...(body.approvalId === undefined ? {} : { approvalId: asAccountTokenId(body.approvalId) }),
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, outcome) =>
        sendJson(response, toOperatorPasswordResetDto(outcome)),
      )
    }),
  )

  return router
}
