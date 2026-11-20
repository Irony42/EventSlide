import { Router } from 'express'
import { asChannelBindingId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole } from '../middleware/authz'
import { hostScopeOf } from '../middleware/scope'
import { toChannelsResponseDto } from '../presenters/presenters'
import { sendJson, sendNoContent, sendResult } from '../presenters/send'
import { channelBindingParams, eventSlugParams } from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The host's "Groupe Telegram" panel (spec 27): which groups send to this event, and the way to unlink one.
 *
 * **No public route exists for the channel**: the messages come in by an outbound long poll (ADR 0015), so the only
 * HTTP surface is the host's. The read is a moderator's (it names no secret: the bot's public handle and the groups'
 * titles the host chose), the unlink is the owner's (it ends a connection the owner made). A binding is resolved
 * **inside the event** the path names: another event's binding id is `404 channel.bindingNotFound`.
 */

export interface ChannelRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<HttpUseCases, 'listChannelBindings' | 'unbindConversation'>
}

export const channelRoutes = ({ deps, usecases }: ChannelRouteDeps): Router => {
  const router = Router()

  /** `GET /events/:eventSlug/channels`. */
  router.get(
    '/events/:eventSlug/channels',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      eventSlugParams.parse(req.params)

      const result = await usecases.listChannelBindings({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, view) => {
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, toChannelsResponseDto(view))
      })
    }),
  )

  /** `DELETE /events/:eventSlug/channels/:bindingId`: the group stops sending its photos here. */
  router.delete(
    '/events/:eventSlug/channels/:bindingId',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const params = channelBindingParams.parse(req.params)

      const result = await usecases.unbindConversation({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        bindingId: asChannelBindingId(params.bindingId),
      })

      sendResult(res, result, (response) => sendNoContent(response))
    }),
  )

  return router
}
