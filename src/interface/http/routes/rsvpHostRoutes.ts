import { Router } from 'express'
import { asGuestRsvpId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole } from '../middleware/authz'
import type { StreamLimiter } from '../middleware/rateLimit'
import { hostScopeOf } from '../middleware/scope'
import {
  toRsvpFormResponseDto,
  toRsvpListResponseDto,
  toRsvpResponseDto,
} from '../presenters/rsvpPresenters'
import { sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import {
  eventSlugParams,
  rsvpActBody,
  rsvpExportQuery,
  rsvpFormBody,
  rsvpParams,
  rsvpReplyBody,
} from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The host's side of the guests' replies (spec 30): the form and its switch, the manual closing,
 * the replies themselves, the badge's "seen" note and the spreadsheet.
 *
 * **The owner's**, like the invitation they hang on (`requireRole('owner')`, and the use cases ask
 * the same right): the replies hold names and diets. Writes are the CSRF-gated, no-store host
 * routes of every other surface; bodies are strict, every value is judged by the domain.
 *
 * `GET rsvp-form` answers the defaults before the host first saves, and nothing is created by a
 * read. A write that needs the invitation is `409 rsvp.inviteRequired` while there is none.
 *
 * The spreadsheet goes through the concurrency bound the ZIP exports share (`hostExportLimiter`,
 * built once by `server.ts`), keyed by account, and a `HEAD` is answered without a slot or a
 * use case, like the archives'. It is a download, never rendered: `attachment`, `nosniff`,
 * `no-store`.
 */

export interface RsvpHostRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<
    HttpUseCases,
    | 'getRsvpForm'
    | 'saveRsvpForm'
    | 'closeRsvps'
    | 'reopenRsvps'
    | 'listRsvps'
    | 'hostAddRsvp'
    | 'hostUpdateRsvp'
    | 'hostDeleteRsvp'
    | 'exportRsvps'
    | 'markRsvpsSeen'
  >
  /** The bound the host's exports share: required, so a router cannot be a second allowance. */
  readonly hostExportLimiter: StreamLimiter
}

export const rsvpHostRoutes = ({
  deps,
  usecases,
  hostExportLimiter: exportLimiter,
}: RsvpHostRouteDeps): Router => {
  const router = Router()

  /** `GET /events/:eventSlug/rsvp-form`. */
  router.get(
    '/events/:eventSlug/rsvp-form',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      eventSlugParams.parse(req.params)

      const result = await usecases.getRsvpForm({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, view) => sendJson(response, toRsvpFormResponseDto(view)))
    }),
  )

  /** `PUT /events/:eventSlug/rsvp-form`: an absent field is left as it was, `null` clears the deadline. */
  router.put(
    '/events/:eventSlug/rsvp-form',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const body = rsvpFormBody.parse(req.body)

      const result = await usecases.saveRsvpForm({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(body.deadline === undefined ? {} : { deadline: body.deadline }),
        ...(body.form === undefined ? {} : { form: body.form }),
      })

      sendResult(res, result, (response, view) => sendJson(response, toRsvpFormResponseDto(view)))
    }),
  )

  /** "Fermer les réponses": the host's hand on the window, whatever the deadline says. */
  router.post(
    '/events/:eventSlug/rsvp-form/close',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      rsvpActBody.parse(req.body)

      const result = await usecases.closeRsvps({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, view) => sendJson(response, toRsvpFormResponseDto(view)))
    }),
  )

  /** "Rouvrir". */
  router.post(
    '/events/:eventSlug/rsvp-form/reopen',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      rsvpActBody.parse(req.body)

      const result = await usecases.reopenRsvps({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, view) => sendJson(response, toRsvpFormResponseDto(view)))
    }),
  )

  /** `GET /events/:eventSlug/rsvps`: every reply, the figures, the badge's count. Marks nothing seen. */
  router.get(
    '/events/:eventSlug/rsvps',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      eventSlugParams.parse(req.params)

      const result = await usecases.listRsvps({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, view) => sendJson(response, toRsvpListResponseDto(view)))
    }),
  )

  /** "Ajouter une réponse". */
  router.post(
    '/events/:eventSlug/rsvps',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const body = rsvpReplyBody.parse(req.body)

      const result = await usecases.hostAddRsvp({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        ...body,
      })

      sendResult(res, result, (response, rsvp) => sendJson(response, toRsvpResponseDto(rsvp), 201))
    }),
  )

  /**
   * The host looked: the badge counts from now on. Declared before `rsvps/:rsvpId`, which would
   * otherwise read `seen` as an id.
   */
  router.post(
    '/events/:eventSlug/rsvps/seen',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      rsvpActBody.parse(req.body)

      const result = await usecases.markRsvpsSeen({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResultNoContent(res, result)
    }),
  )

  /** `GET /events/:eventSlug/rsvps/export?view=all|caterer`: the replies as a CSV file. */
  router.get(
    '/events/:eventSlug/rsvps/export',
    requireRole('owner', deps),
    // A `HEAD` asks whether this `GET` would start: answered with no slot and no use case.
    exportLimiter.answerHead,
    exportLimiter,
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      eventSlugParams.parse(req.params)
      const { view } = rsvpExportQuery.parse(req.query)

      const result = await usecases.exportRsvps({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        view,
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, file) => {
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.setHeader(
          'Content-Disposition',
          `attachment; filename="${file.slug}-${view === 'caterer' ? 'traiteur' : 'reponses'}.csv"`,
        )
        response.status(200).type('text/csv; charset=utf-8').send(file.csv)
      })
    }),
  )

  /** The host corrects a reply: the whole reply is sent again. */
  router.put(
    '/events/:eventSlug/rsvps/:rsvpId',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const params = rsvpParams.parse(req.params)
      const body = rsvpReplyBody.parse(req.body)

      const result = await usecases.hostUpdateRsvp({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        rsvpId: asGuestRsvpId(params.rsvpId),
        ...body,
      })

      sendResult(res, result, (response, rsvp) => sendJson(response, toRsvpResponseDto(rsvp)))
    }),
  )

  /** The host deletes a reply: `204`. */
  router.delete(
    '/events/:eventSlug/rsvps/:rsvpId',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const params = rsvpParams.parse(req.params)

      const result = await usecases.hostDeleteRsvp({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        rsvpId: asGuestRsvpId(params.rsvpId),
      })

      sendResultNoContent(res, result)
    }),
  )

  return router
}
