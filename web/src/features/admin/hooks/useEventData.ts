import { useCallback } from 'react'
import { useApi } from '../../../app/useApi'
import { useLoader, type LoaderState } from './useLoader'
import type {
  EventDto,
  EventSummaryDto,
  GuestListResponse,
  ModeratorDto,
} from '../../../lib/api/dto'

/**
 * The reads the admin surface needs.
 *
 * Each one is a thin `useLoader` over one typed API function, so a page never touches
 * the transport and a test hands the page a fake `Api` through `renderWithProviders`.
 */

export const useEventList = (): LoaderState<readonly EventSummaryDto[]> => {
  const api = useApi()
  const load = useCallback(
    async (signal: AbortSignal) => (await api.listEvents(signal)).items,
    [api],
  )
  return useLoader(load)
}

export const useEvent = (slug: string): LoaderState<EventDto> => {
  const api = useApi()
  const load = useCallback((signal: AbortSignal) => api.getEvent(slug, signal), [api, slug])
  return useLoader(load)
}

export const useGuests = (slug: string): LoaderState<GuestListResponse> => {
  const api = useApi()
  const load = useCallback((signal: AbortSignal) => api.listGuests(slug, signal), [api, slug])
  return useLoader(load)
}

/**
 * The album ZIP address.
 *
 * Not a read — the browser downloads it — but it still comes from the API client, so
 * the link and the endpoint in docs/API.md cannot drift apart.
 */
export const useAlbumUrl = (slug: string): string => useApi().albumUrl(slug)

export const useModerators = (slug: string): LoaderState<readonly ModeratorDto[]> => {
  const api = useApi()
  const load = useCallback(
    async (signal: AbortSignal) => (await api.listModerators(slug, signal)).items,
    [api, slug],
  )
  return useLoader(load)
}
