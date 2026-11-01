import { useCallback } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError } from '../../../lib/http'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import type { HighlightsDto, PreselectHighlightsResponse } from '../../../lib/api/dto'
import { useAction, type ActionState } from './useAction'
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
  return state
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
