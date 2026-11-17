import { useCallback, useMemo } from 'react'
import { useApi } from '../../../lib/useApi'
import { ApiError } from '../../../lib/http'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import { useReadScheduler } from '../../../lib/realtime/useReadScheduler'
import { useEventStream, type StreamSignal } from '../../../lib/realtime/useEventStream'
import type { AlbumExportDto } from '../../../lib/api/dto'
import type { AlbumExportRead } from '../albumDeletion'
import { useAction, type ActionState } from './useAction'
import { useRevalidateWhenVisible } from './useRevalidateWhenVisible'

/**
 * The verified archive's state on the event page (spec 22): its row, read again when the server says
 * it moved (`export.changed` on the moderation stream, a signal with no data) and when the tab comes
 * back. No tight poll: a host who leaves the page finds the answer on return.
 *
 * View-state only. `enabled` is false while the page has no band to show: nothing is asked and no
 * stream is opened, so an event with no date in reach costs the server nothing. A `404` that is not
 * the event's own (`export.notFound`, an older server that lacks the route) reads as "no archive".
 */
export const useAlbumExport = (slug: string, enabled: boolean): LoaderState<AlbumExportRead> => {
  const api = useApi()
  const load = useCallback(
    async (signal: AbortSignal): Promise<AlbumExportRead> => {
      if (!enabled) return 'none'
      try {
        return await api.albumExport(slug, signal)
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404 && cause.code !== 'event.notFound') {
          return 'none'
        }
        throw cause
      }
    },
    [api, slug, enabled],
  )
  const state = useLoader(load)
  const { reload } = state
  useRevalidateWhenVisible(reload)

  const reads = useReadScheduler(reload, { tracksSettlement: false })
  const onSignal = useCallback(
    (signal: StreamSignal) => {
      if (signal.type === 'export.changed') reads.request()
    },
    [reads],
  )
  // The server forgets an event's replay log when its last connection leaves: read in full when
  // the stream comes back, whatever the signals did or did not say.
  const onReconnect = useCallback(() => reads.request({ immediate: true }), [reads])
  const streamUrl = useMemo(() => api.moderationStreamUrl(slug), [api, slug])
  useEventStream({ url: streamUrl, onSignal, onReconnect, enabled })

  return state
}

export const useRequestAlbumExport = (): ActionState<[string], AlbumExportDto> => {
  const api = useApi()
  return useAction(useCallback((slug: string) => api.requestAlbumExport(slug), [api]))
}
