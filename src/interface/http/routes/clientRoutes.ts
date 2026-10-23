import { Router } from 'express'
import { asAccountTokenId } from '../../../domain/shared/ids'
import { DomainError } from '../../../domain/shared/errors'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireUser } from '../middleware/authz'
import { sendError, sendResultNoContent } from '../presenters/send'
import { approveInvitationParams } from '../schemas/clientSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The client's own space, `/api/client/*` (docs/ROADMAP.md §10.9): what an owner of a client
 * does about that client, mounted only on a box with `SITE_ADMIN=on` — with it off there is
 * no client space and every path here answers as an unknown route does.
 *
 * It carries one route today, the owner's half of R1 of the operator guard (G2-12 / P3-14).
 * The rest of the space (`/api/me/limits`, the readable audit, the list of what waits for an
 * owner) is G2-16's.
 *
 * **There is no `requireRole` here, because there is no event.** A client is not an event, and
 * the event routes' question ("what is this account in *this event*") is not this one ("what is
 * this account in *this client*, and does it operate the box"). `requireUser` establishes that
 * there is an active signed-in account; the use case reads everything else from storage, on
 * this request.
 */

export interface ClientRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<HttpUseCases, 'approveInvitation'>
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

  return router
}
