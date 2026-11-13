import { useCallback, useMemo, useRef } from 'react'
import { useApi } from '../../../lib/useApi'
import type { EventStatsResponse } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'
import { useReadScheduler } from '../../../lib/realtime/useReadScheduler'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import { usePollWhile } from './usePollWhile'
import { useRevalidateWhenVisible } from './useRevalidateWhenVisible'

/**
 * The statistics page's read, kept fresh without hammering the server (spec 05, section 3).
 *
 * Every read is a handful of SQL aggregates on a connection the uploads share, so the page
 * rereads on a budget: when the host returns to the tab, on the moderation stream's signals about
 * photos and guests (coalesced over five seconds, so a burst of uploads is one read), and slowly,
 * every thirty seconds, while the tab is visible. `reaction.added` is **not** a trigger: it falls
 * in bursts during a party, and each host tab would rerun the aggregates for every tap.
 *
 * A suspended client's members are refused with `403 client.suspended`, yet the moderation
 * stream keeps serving them, so signals go on arriving. The hook stops rereading after that
 * answer instead of keeping a loop of refused requests alive.
 */

/** What can change the figures. Not `reaction.added`: see above. */
const SIGNALS = new Set([
  'photo.uploaded',
  'photo.moderated',
  'photo.deleted',
  'guest.joined',
  'guest.erased',
])

export const SIGNAL_DEBOUNCE_MS = 5_000
export const SLOW_REFRESH_MS = 30_000

export const useEventStats = (slug: string): LoaderState<EventStatsResponse> => {
  const api = useApi()
  const refused = useRef(false)

  const load = useCallback(
    async (signal: AbortSignal) => {
      refused.current = false
      try {
        return await api.getEventStats(slug, signal)
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'client.suspended') refused.current = true
        throw cause
      }
    },
    [api, slug],
  )
  const state = useLoader(load)
  const { reload } = state

  const refresh = useCallback(() => {
    if (!refused.current) reload()
  }, [reload])

  useRevalidateWhenVisible(refresh)

  // The slow read, only while someone can see the page.
  usePollWhile(true, SLOW_REFRESH_MS, refresh)

  // Signals open a five-second window; whatever arrives inside it is the same one read. Kept at
  // five seconds, unlike the consoles' quarter of a second: each read is a set of SQL aggregates
  // on the connection uploads share, and a figure that is a few seconds late is not a defect.
  const reads = useReadScheduler(refresh, {
    debounceMs: SIGNAL_DEBOUNCE_MS,
    tracksSettlement: false,
  })
  const onSignal = useCallback(
    (signal: StreamSignal) => {
      if (SIGNALS.has(signal.type)) reads.request()
    },
    [reads],
  )
  // No signal tells what happened while the stream was down (the server drops the replay log
  // with its last connection), so the figures are read at once when it comes back.
  const onReconnect = useCallback(() => reads.request({ immediate: true }), [reads])

  const streamUrl = useMemo(() => api.moderationStreamUrl(slug), [api, slug])
  useEventStream({ url: streamUrl, onSignal, onReconnect })

  return state
}
