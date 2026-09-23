import { Router } from 'express'
import { requireGuest } from '../middleware/authz'
import { toPrivacyNoticeStateDto } from '../presenters/presenters'
import { sendJson, sendResult } from '../presenters/send'
import { noticeAcknowledgementBody } from '../schemas/requestSchemas'
import { withGuest } from './guestRoutes'
import type { PrivacyNoticeStateDto } from '../presenters/dto'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'

/**
 * The privacy notice a guest reads before their first upload (roadmap §5.1).
 *
 * Two routes, both the guest's, both behind `requireGuest` — which resolves the device
 * token **against the event in the path**, so a guest of the gala asking about the
 * wedding's notice is refused there, before a use case runs. Whose acknowledgement is
 * read or written comes from the token and never from the request: there is no route by
 * which one guest can read, or record, another's.
 *
 * Its own router rather than two more entries in `guestRoutes`, for the reason
 * `missionRoutes` is one: the module states the two use cases it reaches, and its
 * contract test builds exactly those.
 *
 * Deliberately **not** a gate on the upload routes. The notice is shown by the upload
 * screen, which does not offer the picker until it has been acknowledged; the server does
 * not refuse a photo from a guest who has not. Refusing there would put a new `4xx` in
 * front of the offline outbox, whose whole job is not to lose photos — a queue drained
 * after the host changed retention would be answered with a refusal for a photo the guest
 * took under the old notice — and what it would prevent is a client that skipped the
 * screen on purpose, which is not a guest who was left uninformed.
 */

export interface PrivacyNoticeRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<HttpUseCases, 'getPrivacyNotice' | 'acknowledgePrivacyNotice'>
}

export const privacyNoticeRoutes = ({ deps, usecases }: PrivacyNoticeRouteDeps): Router => {
  const router = Router()

  /**
   * `GET /events/:eventSlug/privacy-notice` — the notice in force, and whether this device
   * has read it.
   *
   * Never cached: this is the read that tells a guest who joined at 19:00 that the host
   * changed retention at 22:00, and a stored copy would tell them it had not.
   */
  router.get(
    '/events/:eventSlug/privacy-notice',
    requireGuest(deps),
    withGuest(async ({ event, guest }, _req, res) => {
      const result = await usecases.getPrivacyNotice({ eventId: event.id, guestId: guest.id })

      sendResult(res, result, (response, view) => {
        response.setHeader('Cache-Control', 'no-store')
        const dto: PrivacyNoticeStateDto = toPrivacyNoticeStateDto(view)
        sendJson(response, dto)
      })
    }),
  )

  /**
   * `POST /events/:eventSlug/privacy-notice/acknowledgement` — "J'ai compris".
   *
   * `POST` rather than `PUT` although it is idempotent, because the rest of this API
   * records an action with `POST` (`/guests/:guestId/revoke`) and the client transport has
   * no `PUT`. Answers the same body as the read, so the phone learns its new standing
   * without asking twice; `409 privacyNotice.outdated` when the revision it sends is no
   * longer the one in force.
   */
  router.post(
    '/events/:eventSlug/privacy-notice/acknowledgement',
    requireGuest(deps),
    withGuest(async ({ event, guest }, req, res) => {
      const body = noticeAcknowledgementBody.parse(req.body)

      const result = await usecases.acknowledgePrivacyNotice({
        eventId: event.id,
        guestId: guest.id,
        revision: body.revision,
      })

      sendResult(res, result, (response, view) => {
        response.setHeader('Cache-Control', 'no-store')
        const dto: PrivacyNoticeStateDto = toPrivacyNoticeStateDto(view)
        sendJson(response, dto)
      })
    }),
  )

  return router
}
