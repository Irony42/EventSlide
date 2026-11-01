import { Router } from 'express'
import type { RequestHandler } from 'express'
import { asGuestbookEntryId } from '../../../domain/shared/ids'
import { requireGuest } from '../middleware/authz'
import {
  GUESTBOOK_WRITES_PER_GUEST_PER_MINUTE,
  guestWriteLimiter,
  guestbookGuestLimiter,
} from '../middleware/rateLimit'
import { withGuest } from '../middleware/scope'
import { toCreatedGuestbookEntryDto, toGuestbookEntryDto } from '../presenters/presenters'
import { sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import { guestbookBody, guestbookEntryParams } from '../schemas/requestSchemas'
import type { MyGuestbookDto } from '../presenters/dto'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'

/**
 * The guest's side of the guestbook (spec 01): write a message, read one's own, take one back.
 *
 * Three routes, every one the guest's and every one behind `requireGuest`, which resolves the
 * device token to a guest and refuses a revoked one (a revoked guest keeps only "delete everything
 * I sent"). **Whose message it is comes from the token and never from the request**: the body
 * carries text and nothing else, and `:entryId` names a row that the use case then checks belongs
 * to that guest.
 *
 * ## Two limiters, in two stages
 *
 * The coarse one, `guestWriteLimiter`, is per address and event and sits **ahead** of
 * `requireGuest`, as it does for every other guest write, so a flood is dropped before it costs a
 * token check. It is the bucket `guestRoutes` and the notice route already share, built once by
 * `server.ts`. The fine one, `guestbookGuestLimiter`, is per **guest** and sits right after
 * `requireGuest`, and it exists because the ceiling of three messages does not bound the abuse:
 * writing then taking back in a loop never holds more than three rows but announces a
 * `guestbook.changed` every turn, which makes every projector in the room re-read the wall, up to
 * 300 times a minute from one address. Writing and taking back spend **the same** budget (one
 * instance, built once here), and its value is a constant in code, not a setting.
 *
 * There is no `deferToHostSurface` on the `DELETE`: the host has no `DELETE` on this path, so
 * there is no ambiguity about who is calling.
 */

export interface GuestbookRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<
    HttpUseCases,
    'createGuestbookEntry' | 'listMyGuestbookEntries' | 'deleteGuestbookEntry'
  >
  /**
   * The guest-write bucket, **shared with `guestRoutes`** and built once by `server.ts`
   * (HTTP-H-01). Optional only so a test can mount this router alone.
   */
  readonly guestWriteRateLimiter?: RequestHandler
  /** The per-guest budget, overridable so a test can reach it in a few requests. */
  readonly writesPerGuestPerMinute?: number
}

export const guestbookRoutes = ({
  deps,
  usecases,
  guestWriteRateLimiter = guestWriteLimiter(deps.config.rateLimits.guestWritePerMinute),
  writesPerGuestPerMinute = GUESTBOOK_WRITES_PER_GUEST_PER_MINUTE,
}: GuestbookRouteDeps): Router => {
  const router = Router()

  /** One instance for the two writes: a guest who writes and removes is one guest. */
  const guestWrites = guestbookGuestLimiter(writesPerGuestPerMinute)

  /**
   * `POST /events/:eventSlug/guestbook` - a message.
   *
   * `201` with the stored message, including when it was the same message sent a moment ago
   * (`duplicate: true`, no new row, no new signal): a double tap and a retry on bad Wi-Fi answer
   * what the first request did, which is the convention a duplicate photograph already has.
   */
  router.post(
    '/events/:eventSlug/guestbook',
    guestWriteRateLimiter,
    requireGuest(deps),
    guestWrites,
    withGuest(async ({ event, guest }, req, res) => {
      const body = guestbookBody.parse(req.body)

      const result = await usecases.createGuestbookEntry({
        eventId: event.id,
        guestId: guest.id,
        text: body.text,
      })

      sendResult(res, result, (response, created) => {
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, toCreatedGuestbookEntryDto(created.entry, created.duplicate), 201)
      })
    }),
  )

  /**
   * `GET /events/:eventSlug/guestbook/mine` - the guest's own messages, with the server's verdict
   * on whether each can be taken back and whether a new one would be taken.
   *
   * `mine`, like `photos/mine` beside it, so there is no route by which one guest reads
   * another's. Never cached: it is the view a guest reloads to see whether the host published.
   */
  router.get(
    '/events/:eventSlug/guestbook/mine',
    requireGuest(deps),
    withGuest(async ({ event, guest }, _req, res) => {
      const result = await usecases.listMyGuestbookEntries({
        eventId: event.id,
        guestId: guest.id,
      })

      sendResult(res, result, (response, mine) => {
        response.setHeader('Cache-Control', 'no-store')
        const dto: MyGuestbookDto = {
          items: mine.items.map((item) => toGuestbookEntryDto(item.entry, item.canDelete)),
          accepting: mine.accepting,
          onWall: mine.onWall,
        }
        sendJson(response, dto)
      })
    }),
  )

  /**
   * `DELETE /events/:eventSlug/guestbook/:entryId` - take one's own message back.
   *
   * The rule is the photograph's (`GuestbookEntry.deletionVerdict`); the answers are
   * `404 guestbook.notFound` (also for somebody else's message), `403
   * event.guestSelfDeleteDisabled` and `403 guestbook.deleteForbidden`, and `204` on success.
   */
  router.delete(
    '/events/:eventSlug/guestbook/:entryId',
    guestWriteRateLimiter,
    requireGuest(deps),
    guestWrites,
    withGuest(async ({ event, guest }, req, res) => {
      const params = guestbookEntryParams.parse(req.params)

      const result = await usecases.deleteGuestbookEntry({
        eventId: event.id,
        entryId: asGuestbookEntryId(params.entryId),
        guestId: guest.id,
      })

      sendResultNoContent(res, result)
    }),
  )

  return router
}
