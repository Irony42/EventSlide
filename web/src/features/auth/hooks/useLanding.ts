import { useCallback } from 'react'
import { useAbout } from '../../../app/useAbout'
import { useApi } from '../../../app/useApi'
import { chosenPath, landingPath, onPhone, ADMIN_HOME } from '../../../lib/landing'

/**
 * What the account itself says about whether it operates the box, when the caller already holds
 * the session answer. Omitted, it is read from `GET /api/auth/me`, and only when the rules need it.
 */
export interface LandingOptions {
  /** The navigation state the sign-in page was entered with (`from`). */
  readonly state: unknown
  readonly canOperateSite?: boolean
}

/**
 * Where to send somebody who is in: the page they were heading for if they chose one, else the
 * landing the rules in `lib/landing.ts` give their account (decisions 2 and 3).
 *
 * The reads are the account's own and run **only when no page was chosen**: the list of events;
 * its one event, to learn the role, when there is exactly one; and, for an account with no event
 * on a box that has a console, its clients and whether it operates the box. A moderator or a host
 * costs one or two requests, an operator with nothing three. **A read that fails is not a reason
 * to keep somebody on the sign-in form**: the answer is then the list of events, which is where
 * everybody was sent before there were rules.
 */
/** How long the reads may take before the person is sent to the list of events without them. */
export const LANDING_TIMEOUT_MS = 8000

export const useResolveLanding = (): ((options: LandingOptions) => Promise<string>) => {
  const api = useApi()
  const consoleExists = useAbout().features.siteAdmin

  return useCallback(
    async ({ state, canOperateSite }: LandingOptions): Promise<string> => {
      const chosen = chosenPath(state)
      if (chosen !== null) return chosen
      // A read that never answers (venue Wi-Fi) is not a reason to leave somebody on a spinner
      // with no form and no link: after a while they are sent to the list of events.
      let timer: ReturnType<typeof setTimeout> | undefined
      const gaveUp = new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(ADMIN_HOME), LANDING_TIMEOUT_MS)
      })
      const decided = (async (): Promise<string> => {
        try {
          const eventSlugs = (await api.listEvents()).items.map((event) => event.slug)
          const [only] = eventSlugs
          const soleEventRole =
            eventSlugs.length === 1 && only !== undefined ? (await api.getEvent(only)).role : null

          let clientCount = 0
          let operatesConsole = false
          if (eventSlugs.length === 0 && consoleExists) {
            clientCount = (await api.myLimits()).clients.length
            if (clientCount === 0) {
              if (canOperateSite !== undefined) {
                operatesConsole = canOperateSite
              } else {
                const me = await api.session()
                operatesConsole = me.authenticated && me.user.canOperateSite
              }
            }
          }

          return landingPath({
            eventSlugs,
            soleEventRole,
            clientCount,
            operatesConsole,
            phone: onPhone(),
          })
        } catch {
          return ADMIN_HOME
        }
      })()
      try {
        return await Promise.race([decided, gaveUp])
      } finally {
        clearTimeout(timer)
      }
    },
    [api, consoleExists],
  )
}
