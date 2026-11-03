import { useEffect, useState } from 'react'
import { useApi } from '../../../app/useApi'
import type { EventDto } from '../../../lib/api/dto'

/**
 * Whether this browser holds an **owner** session on the event, and the event's settings if so.
 *
 * A convenience for the interface, not a barrier: `PATCH /settings` is `requireRole('owner')` and
 * CSRF-protected on the server whatever this says (spec 13, rule 1). The answer is read from the
 * host API (`GET /events/:slug`, `moderator` or better, which carries the caller's `role`): a `401`
 * (anonymous), a `404` (no part in the event), a failure or a slow answer all leave `null`, so the
 * panel is **absent by default** and a guest on `/display` never has its DOM.
 *
 * It runs **once**, and only after the wall has something to show (`enabled`), so it has no effect
 * on the first render of a projector that runs for eight hours. A moderator reads `role:
 * 'moderator'` and gets no panel: only the owner may write the settings.
 */
export interface WallOwner {
  readonly event: EventDto
  /** The settings as the server last answered them, replaced after each save. */
  readonly replace: (event: EventDto) => void
}

export const useWallOwner = (slug: string, enabled: boolean): WallOwner | null => {
  const api = useApi()
  const [event, setEvent] = useState<EventDto | null>(null)

  useEffect(() => {
    if (!enabled || slug === '') return
    const controller = new AbortController()
    api.getEvent(slug, controller.signal).then(
      (found) => {
        if (!controller.signal.aborted && found.role === 'owner') setEvent(found)
      },
      () => undefined,
    )
    return () => controller.abort()
  }, [api, slug, enabled])

  return event === null ? null : { event, replace: setEvent }
}
