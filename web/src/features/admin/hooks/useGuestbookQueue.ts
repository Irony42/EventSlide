import { useCallback, useMemo } from 'react'
import { useApi } from '../../../lib/useApi'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import type { GuestbookQueueDto } from '../../../lib/api/dto'

/**
 * The host's reading of the guestbook (spec 01), kept fresh by the moderation stream: a
 * `guestbook.changed` frame refetches, because a guest writing or taking a message back is
 * what a host sitting on this page wants to see happen.
 */
export const useGuestbookQueue = (slug: string): LoaderState<GuestbookQueueDto> => {
  const api = useApi()
  const load = useCallback((signal: AbortSignal) => api.guestbookQueue(slug, signal), [api, slug])
  const state = useLoader(load)
  const { reload } = state

  const onSignal = useCallback(
    (signal: StreamSignal) => {
      if (signal.type === 'guestbook.changed') reload()
    },
    [reload],
  )
  const streamUrl = useMemo(() => api.moderationStreamUrl(slug), [api, slug])
  useEventStream({ url: streamUrl, onSignal })

  return state
}
