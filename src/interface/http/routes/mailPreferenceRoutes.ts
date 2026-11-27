import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireUser } from '../middleware/authz'
import { userOf } from '../middleware/scope'
import type { MailPreferencesDto } from '../presenters/dto'
import { sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import { mailPreferencesBody } from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * What the signed-in account chose to receive by mail (spec 32, ADR 0019), `/api/me/mail-preferences`.
 *
 * - `GET`: `{ rsvp, event, available }`. `available` is the same fact as `features.hostMail` of
 *   `/api/about` (the mailer delivers and `HOST_MAIL_NOTICES` is not `off`): the account's page offers the
 *   switches only then. They can still be set when it is `false`, so a host's choice survives the day a
 *   relay is configured.
 * - `PUT`: `{ rsvp?, event? }`, each a real boolean, no other key, `204`. **The account is the session's**: no
 *   route reads another account's switches and no parameter names one. CSRF-gated like every write.
 *
 * Mounted on every box (a self-hoster's account has the same two switches), unlike `/api/me/limits`, which
 * belongs to the client space. The security mails and the warning before the replies are erased have no
 * switch, so there is nothing here for them.
 */

export interface MailPreferenceRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<HttpUseCases, 'getMailPreferences' | 'setMailPreferences'>
}

export const mailPreferenceRoutes = ({ deps, usecases }: MailPreferenceRouteDeps): Router => {
  const router = Router()

  router.get(
    '/me/mail-preferences',
    requireUser(deps),
    asyncHandler(async (req, res) => {
      const user = userOf(req)

      const result = await usecases.getMailPreferences({ userId: user.userId })

      // Personal to the caller, and changed by them: never kept by a cache.
      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, preferences) =>
        sendJson<MailPreferencesDto>(response, {
          rsvp: preferences.rsvp,
          event: preferences.event,
          available: preferences.available,
        }),
      )
    }),
  )

  router.put(
    '/me/mail-preferences',
    requireUser(deps),
    asyncHandler(async (req, res) => {
      const user = userOf(req)
      const body = mailPreferencesBody.parse(req.body)

      const result = await usecases.setMailPreferences({
        userId: user.userId,
        rsvp: body.rsvp,
        event: body.event,
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResultNoContent(res, result)
    }),
  )

  return router
}
