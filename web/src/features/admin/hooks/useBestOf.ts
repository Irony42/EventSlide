import { useCallback } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError } from '../../../lib/http'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import type { HighlightsDto, PreselectHighlightsResponse, ReelDto } from '../../../lib/api/dto'
import { useAction, type ActionState } from './useAction'
import { usePollWhile } from './usePollWhile'
import { useRevalidateWhenVisible } from './useRevalidateWhenVisible'

/**
 * The best-of panel's state (spec 08): how many favourites there are, and the pre-selection.
 *
 * View-state only, no rule. The count is the server's, and the same predicate decides the
 * ZIP, so "12 favourites" never opens an empty archive. It is read again when the tab regains
 * focus: the host stars photos in the moderation console, and there is no live channel for
 * it in this version.
 *
 * **A server older than the panel** answers `404` on a route it does not have; the loader
 * says `'unsupported'` then and the panel renders nothing, instead of an error on a page
 * that otherwise works. An event that is genuinely absent (`event.notFound`) stays an error.
 */

/** How often the montage's state is read while it is being made (spec 08). */
export const REEL_POLL_MS = 3000

export type BestOfRead = HighlightsDto | 'unsupported'

export const useBestOf = (slug: string): LoaderState<BestOfRead> => {
  const api = useApi()
  const load = useCallback(
    async (signal: AbortSignal): Promise<BestOfRead> => {
      try {
        return await api.highlights(slug, signal)
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

  // The montage is made in the background: read its state again while it is queued or running,
  // and only then, and only while the host can see the page.
  const reel =
    state.data === null || state.data === 'unsupported' ? null : (state.data.reel ?? null)
  const making = reel?.status === 'queued' || reel?.status === 'running'
  const { reload } = state
  usePollWhile(making, REEL_POLL_MS, reload)
  return state
}

export const useRequestReel = (): ActionState<[string], ReelDto> => {
  const api = useApi()
  return useAction(useCallback((slug: string) => api.requestReel(slug), [api]))
}

export const usePreselectHighlights = (): ActionState<
  [string, number],
  PreselectHighlightsResponse
> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, limit: number) => api.preselectHighlights(slug, limit), [api]),
  )
}
