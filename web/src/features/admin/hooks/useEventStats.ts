import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useApi } from '../../../app/useApi'
import type { EventStatsResponse } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
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
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, SLOW_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  // Signals open a five-second window; whatever arrives inside it is the same one read.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current)
    },
    [],
  )
  const onSignal = useCallback(
    (signal: StreamSignal) => {
      if (!SIGNALS.has(signal.type) || pending.current !== null) return
      pending.current = setTimeout(() => {
        pending.current = null
        refresh()
      }, SIGNAL_DEBOUNCE_MS)
    },
    [refresh],
  )

  const streamUrl = useMemo(() => api.moderationStreamUrl(slug), [api, slug])
  useEventStream({ url: streamUrl, onSignal })

  return state
}
