import { useCallback, useMemo } from 'react'
import { useApi } from '../../../app/useApi'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import { useAction, type ActionState } from './useAction'
import type { GuestbookQueueDto, ModerationDecision } from '../../../lib/api/dto'

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

export const useDecideGuestbookEntry = (): ActionState<
  [slug: string, entryId: string, decision: ModerationDecision],
  void
> => {
  const api = useApi()
  return useAction(
    useCallback(
      (slug: string, entryId: string, decision: ModerationDecision) =>
        api.decideGuestbookEntry(slug, entryId, decision),
      [api],
    ),
  )
}
