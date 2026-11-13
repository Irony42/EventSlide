import { useCallback, useState } from 'react'
import type { EventStatus } from '../../../lib/api/dto'
import { useApi } from '../../../lib/useApi'
import { useAmendSession, useSession } from '../../../lib/useSession'
import { offersTourOnArrival } from '../eventTour'

export interface EventTourState {
  readonly open: boolean
  /** The page's "Visite guidée" button. */
  readonly replay: () => void
  /** Called by the tour on its last step, and when it is left early: both count as seen. */
  readonly close: () => void
}

/**
 * Whether the event page's guided tour is showing (surface: the host and the moderator).
 *
 * It opens by itself on an account's first visit (`toursSeen` on `GET /api/auth/me`, so per
 * account and not per browser), unless `offersTourOnArrival` says the moment is wrong; it opens
 * on the button any time. Closing it, at the end or early, records it as seen on the server and
 * in the shared session, so neither another page of this console nor another device offers it a
 * second time. A failed write is not shown to the host: the worst it costs is the tour offered
 * once more, on the next device.
 */
export const useEventTour = (
  facts: { readonly status: EventStatus; readonly pendingCount: number } | null,
): EventTourState => {
  const api = useApi()
  const { session } = useSession()
  const amend = useAmendSession()
  const [state, setState] = useState<'arriving' | 'open' | 'closed'>('arriving')

  const seen = session?.authenticated === true ? session.user.toursSeen : null
  const offered =
    facts !== null &&
    seen !== null &&
    offersTourOnArrival({ toursSeen: seen, status: facts.status, pendingCount: facts.pendingCount })

  const replay = useCallback(() => setState('open'), [])

  const close = useCallback(() => {
    setState('closed')
    if (seen === null || seen.includes('eventPage')) return
    // Kept in the shared session at once, so another event's page in this console does not offer
    // it again; and told to the server, so another device does not either.
    amend((current) =>
      current.authenticated
        ? {
            ...current,
            user: { ...current.user, toursSeen: [...current.user.toursSeen, 'eventPage'] },
          }
        : current,
    )
    api.markTourSeen('eventPage').catch(() => undefined)
  }, [amend, api, seen])

  return { open: state === 'open' || (state === 'arriving' && offered), replay, close }
}
