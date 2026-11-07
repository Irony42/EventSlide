import { useCallback } from 'react'
import { useApi } from '../../../lib/useApi'
import type { EventDto } from '../../../lib/api/dto'
import { useLoader } from '../../../lib/useLoader'

/**
 * Whether this browser holds an **owner** session on the event, and the event's settings if so.
 *
 * A convenience for the interface, not a barrier: `PATCH /settings` is `requireRole('owner')` and
 * CSRF-protected on the server whatever this says (spec 13, rule 1). The answer is read from the
 * host API (`GET /events/:slug`, `moderator` or better, which carries the caller's `role`): a `401`
 * (anonymous), a `404` (no part in the event), a failure or a slow answer all leave `null`, so the
 * panel is **absent by default** and a guest on `/display` never has its DOM.
 *
 * It reads **once**, through `useLoader`, and only after the wall has something to show
 * (`enabled`: until then the request never settles and nothing is asked), so it has no effect on
 * the first render of a projector that runs for eight hours. A moderator reads `role:
 * 'moderator'` and gets no panel: only the owner may write the settings.
 */
export interface WallOwner {
  readonly event: EventDto
  /** The settings as the server last answered them, replaced after each save. */
  readonly replace: (event: EventDto) => void
}

export const useWallOwner = (slug: string, enabled: boolean): WallOwner | null => {
  const api = useApi()
  const load = useCallback(
    (signal: AbortSignal): Promise<EventDto> =>
      enabled && slug !== '' ? api.getEvent(slug, signal) : new Promise<EventDto>(() => undefined),
    [api, slug, enabled],
  )
  const { data, replace } = useLoader(load)

  return data !== null && data.role === 'owner' ? { event: data, replace } : null
}
