import { useCallback, useMemo } from 'react'
import { useApi } from '../../../lib/useApi'
import { useReadScheduler } from '../../../lib/realtime/useReadScheduler'
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

  // The loader cannot report when its read ends, so only the burst window applies here: a flurry
  // of messages is one read. (`useLoader.reload` still restarts a read in flight; that is the
  // loader's own policy, and a later change to it needs no change here.)
  const reads = useReadScheduler(reload, { tracksSettlement: false })

  const onSignal = useCallback(
    (signal: StreamSignal) => {
      if (signal.type === 'guestbook.changed') reads.request()
    },
    [reads],
  )
  // The server forgets an event's replay log when its last connection leaves: read in full
  // when the stream comes back, whatever the signals did or did not say.
  const onReconnect = useCallback(() => reads.request({ immediate: true }), [reads])
  const streamUrl = useMemo(() => api.moderationStreamUrl(slug), [api, slug])
  useEventStream({ url: streamUrl, onSignal, onReconnect })

  return state
}
