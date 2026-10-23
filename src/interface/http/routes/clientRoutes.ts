import { Router } from 'express'
import { asAccountTokenId, asClientId } from '../../../domain/shared/ids'
import { DomainError } from '../../../domain/shared/errors'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireUser } from '../middleware/authz'
import { toClientAuditPageDto, toPendingInvitationsDto } from '../presenters/presenters'
import { sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import {
  approveInvitationParams,
  approvePasswordResetParams,
  clientAuditQuery,
  pendingInvitationsQuery,
} from '../schemas/clientSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The client's own space, `/api/client/*` (docs/ROADMAP.md §10.9): what an owner of a client
 * does about that client, mounted only on a box with `SITE_ADMIN=on` — with it off there is
 * no client space and every path here answers as an unknown route does.
 *
 * It carries the owner's half of R1 of the operator guard (G2-12 / P3-14: approving an invitation),
 * the owner's half of R2 (G2-14: approving an operator's request for a password-reset link, on a
 * box with no mail relay and `OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval`) and what an
 * owner reads of their own client (G2-16 / P3-17: the log of what the operator did, and the
 * list of what waits for them). `/api/me/limits`, which every member reads, is `meRoutes.ts`.
 *
 * **Every read is the use case's to scope.** A route here never passes a client id through: the
 * query may name one, and the use case checks it against the caller's own roster and answers
 * `404 client.notFound` for any client the caller is not in, so there is no client id a caller
 * can try to read another's log with.
 *
 * **There is no `requireRole` here, because there is no event.** A client is not an event, and
 * the event routes' question ("what is this account in *this event*") is not this one ("what is
 * this account in *this client*, and does it operate the box"). `requireUser` establishes that
 * there is an active signed-in account; the use case reads everything else from storage, on
 * this request.
 */

export interface ClientRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<
    HttpUseCases,
    'approveInvitation' | 'approvePasswordReset' | 'listClientAudit' | 'listPendingInvitations'
  >
}

export const clientRoutes = ({ deps, usecases }: ClientRouteDeps): Router => {
  const router = Router()

  /**
   * An owner of the client lets an operator's invitation in.
   *
   * **Refused to an operator, whoever they also are in the client**, and to a member who is
   * not an owner; answered `404 invitation.notFound` to anybody with no part in the client
   * and for every id that is not an invitation waiting on one of its owners. Nothing in the
   * answer says whom the invitation is for: an owner is shown that in the list G2-16 adds.
   * `204` also for an invitation that was already approved, which changes nothing.
   */
  router.post(
    '/client/invitations/:invitationId/approve',
    requireUser(deps),
    asyncHandler(async (req, res) => {
      const user = req.context.user
      if (!user) {
        // `requireUser` always populates it; this keeps the type honest without the
        // non-null assertion the strict settings forbid.
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }

      const params = approveInvitationParams.parse(req.params)

      const result = await usecases.approveInvitation({
        // From the session, never from the request: an actor a client could name would be an
        // approval anybody could cast in anybody's name.
        actorId: user.userId,
        invitationId: asAccountTokenId(params.invitationId),
      })

      sendResultNoContent(res, result)
    }),
  )

  /**
   * **Another** owner of an account's client lets an operator be handed that account's
   * password-reset link (R2, `copyLinkWithOwnerApproval`). The consent is the same as the
   * invitation's and judged by the same gate (`approvalGate`): a signed-in, enabled owner of the
   * client who does not operate the box, and who is not the account being reset.
   *
   * Approving hands nobody a link: it makes the request redeemable once, by the operator who made
   * it, who is then given a link that did not exist until that moment. `404 reset.requestNotFound`
   * is one answer for an unknown id, an invitation's, a request that is spent, revoked or expired,
   * a request for an account of another client or of none or of two, and a caller with no part in
   * the client; `204` also for a request already approved, which changes nothing.
   */
  router.post(
    '/client/password-resets/:requestId/approve',
    requireUser(deps),
    asyncHandler(async (req, res) => {
      const user = req.context.user
      if (!user) {
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }

      const params = approvePasswordResetParams.parse(req.params)

      const result = await usecases.approvePasswordReset({
        // From the session, never from the request: an approval anybody could cast in anybody's name.
        actorId: user.userId,
        requestId: asAccountTokenId(params.requestId),
      })

      sendResultNoContent(res, result)
    }),
  )

  /**
   * The log of the owner's own client: every entry written about it, newest first, paged by
   * `before`. **Owners only** (`403 client.ownerRequired` for a member), and only the client
   * the caller is in: another client's id is `404 client.notFound`, the answer for a client that
   * does not exist. No account is named in it (`toClientAuditPageDto`).
   */
  router.get(
    '/client/audit',
    requireUser(deps),
    asyncHandler(async (req, res) => {
      const user = req.context.user
      if (!user) {
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }
      const query = clientAuditQuery.parse(req.query)

      const result = await usecases.listClientAudit({
        actorId: user.userId,
        ...(query.clientId === undefined ? {} : { clientId: asClientId(query.clientId) }),
        ...(query.before === undefined ? {} : { before: query.before }),
        limit: query.limit,
      })

      // Personal to the caller and moving: never kept by a cache.
      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, page) => sendJson(response, toClientAuditPageDto(page)))
    }),
  )

  /**
   * What waits for the owner's approval: the operator's invitations into the client that cannot
   * be used until an owner lets them in, and whom they are for. The owner's list for the
   * approve route above, with the one fact that route's answer withholds.
   */
  router.get(
    '/client/invitations',
    requireUser(deps),
    asyncHandler(async (req, res) => {
      const user = req.context.user
      if (!user) {
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }
      const query = pendingInvitationsQuery.parse(req.query)

      const result = await usecases.listPendingInvitations({
        actorId: user.userId,
        ...(query.clientId === undefined ? {} : { clientId: asClientId(query.clientId) }),
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, items) =>
        sendJson(response, toPendingInvitationsDto(items)),
      )
    }),
  )

  return router
}
