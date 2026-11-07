import { useCallback } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError } from '../../../lib/http'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import type { AlbumBookInput } from '../../../lib/api/client'
import type { AlbumBookDto } from '../../../lib/api/dto'
import { useAction, type ActionState } from './useAction'
import { usePollWhile } from './usePollWhile'
import { useRevalidateWhenVisible } from './useRevalidateWhenVisible'

/**
 * The photo book panel's state (spec 04): the book's row, read again while it is being made.
 *
 * View-state only, no rule. A book is made in the background, so while its status is `queued` or
 * `running` the panel asks again every few seconds (a poll, not a stream: the panel is one card
 * on a page that otherwise has no live channel, and a host waits on it for a minute at most). It
 * is read again when the tab regains focus too. A server older than the panel answers `404` on a
 * route it does not have, which reads as `'unsupported'` and renders nothing; an event that is
 * genuinely absent (`event.notFound`) stays an error.
 */

export type AlbumBookRead = AlbumBookDto | 'unsupported'

/** How often the panel asks while a book is being made. */
export const BOOK_POLL_MS = 4_000

export const useAlbumBook = (slug: string): LoaderState<AlbumBookRead> => {
  const api = useApi()
  const load = useCallback(
    async (signal: AbortSignal): Promise<AlbumBookRead> => {
      try {
        return await api.albumBook(slug, signal)
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404 && cause.code !== 'event.notFound') {
          return 'unsupported'
        }
        throw cause
      }
    },
    [api, slug],
  )
  const state = useLoader(load)
  useRevalidateWhenVisible(state.reload)

  const active =
    state.data !== null &&
    state.data !== 'unsupported' &&
    (state.data.status === 'queued' || state.data.status === 'running')
  const { reload } = state
  usePollWhile(active, BOOK_POLL_MS, reload)

  return state
}

export const useRequestAlbumBook = (): ActionState<[string, AlbumBookInput], AlbumBookDto> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, body: AlbumBookInput) => api.requestAlbumBook(slug, body), [api]),
  )
}

export const useDeleteAlbumBook = (): ActionState<[string], void> => {
  const api = useApi()
  return useAction(useCallback((slug: string) => api.deleteAlbumBook(slug), [api]))
}
