import { Router } from 'express'
import { toAboutDto, type AboutFacts } from '../presenters/aboutPresenter'
import type { AboutFeaturesDto } from '../presenters/dto'

/**
 * `GET /api/about`: what this box is, its licence and **where its source is** (roadmap
 * G1-04 / P1-05) — the machine-readable half of the offer AGPL section 13 requires of a
 * network service. The other half is the link every guest and host screen renders from it.
 *
 * **Public, and mounted ahead of the session.** `buildServer` puts it beside
 * `healthRoutes`, before the body parser, the cookie parser, the session and the CSRF
 * gate, for the same reason: a first visit is a phone with no cookie jar, one that does
 * carry a stale `es_session` must not be answered by way of the store, and neither costs
 * the box a session row. So this router declares no authorization decision, and
 * `NOT_EVENT_SCOPED` in `siteOperatorScope.test.ts` says why that is not an omission.
 *
 * **There is deliberately no way to switch it off.** The configuration can change where
 * `sourceUrl` points (`SOURCE_CODE_URL`) and nothing can make the endpoint, or the link
 * built from it, go away.
 *
 * Cacheable by anyone for five minutes: the body is the same for every caller and changes
 * only when the box is redeployed, and the SPA asks for it on its first paint.
 */
export const aboutRoutes = (facts: AboutFacts, features: AboutFeaturesDto): Router => {
  const router = Router()
  const body = toAboutDto(facts, features)

  router.get('/about', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.json(body)
  })

  return router
}
