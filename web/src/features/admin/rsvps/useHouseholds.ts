import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { HouseholdListResponseDto } from '../../../lib/api/dto'
import { useReadScheduler } from '../../../lib/realtime/useReadScheduler'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'
import { useApi } from '../../../lib/useApi'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import { useRevalidateWhenVisible } from '../hooks/useRevalidateWhenVisible'

/**
 * The guest list's read, kept live (spec 30, lot 3): the moderation stream says **that** the replies
 * changed (`rsvp.changed`, no content: a household's answer is one), and the list is read again,
 * coalesced over a short window so a burst of answers is one read. Households are the host's own
 * typing, so the list is never marked "seen": that is the replies page's.
 */

/** A burst of answers is one read. */
export const HOUSEHOLD_SIGNAL_DEBOUNCE_MS = 400

export const useHouseholds = (slug: string): LoaderState<HouseholdListResponseDto> => {
  const api = useApi()
  const load = useCallback((signal: AbortSignal) => api.households(slug, signal), [api, slug])
  const state = useLoader(load)
  const { reload } = state

  const refresh = useCallback(() => reload(), [reload])
  useRevalidateWhenVisible(refresh)

  const reads = useReadScheduler(refresh, {
    debounceMs: HOUSEHOLD_SIGNAL_DEBOUNCE_MS,
    tracksSettlement: false,
  })
  const onSignal = useCallback(
    (signal: StreamSignal) => {
      if (signal.type === 'rsvp.changed') reads.request()
    },
    [reads],
  )
  // Nothing says what happened while the stream was down: the list is read at once when it is back.
  const onReconnect = useCallback(() => reads.request({ immediate: true }), [reads])
  const streamUrl = useMemo(() => api.moderationStreamUrl(slug), [api, slug])
  const { connected } = useEventStream({ url: streamUrl, onSignal, onReconnect })
  // The first connection says nothing of what came in between the read and its opening: read once more.
  const wasConnected = useRef(false)
  useEffect(() => {
    if (!connected || wasConnected.current) return
    wasConnected.current = true
    reads.request({ immediate: true })
  }, [connected, reads])

  return state
}
