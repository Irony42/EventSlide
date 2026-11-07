import { useCallback, useState } from 'react'
import { useApi } from '../../../lib/useApi'
import { serverOffsetMs } from '../../../lib/serverClock'
import { useLoader, type LoaderState } from '../../../lib/useLoader'
import type {
  EventDto,
  EventSummaryDto,
  GuestListResponse,
  HostChallengeResponse,
  MissionDto,
  ModeratorDto,
  ShareLinkResponse,
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

/**
 * The host's prompt list, with how the room is answering it (roadmap §2.1).
 *
 * No paging: an event may hold at most twelve prompts, so the whole list is the page.
 * The counts come back with it — they are a query rather than a column, so reading the
 * list is reading them.
 */
export const useMissions = (slug: string): LoaderState<readonly MissionDto[]> => {
  const api = useApi()
  const load = useCallback(
    async (signal: AbortSignal) => (await api.listMissions(slug, signal)).items,
    [api, slug],
  )
  return useLoader(load)
}

/**
 * The event's timed photo challenge as the console reads it (spec 10), with the server's clock.
 * Re-read by the panel after every action and when the countdown reaches zero: the end of a
 * challenge is derived from the clock and announces nothing.
 */
export const useChallenge = (
  slug: string,
): LoaderState<HostChallengeResponse> & { readonly offsetMs: number } => {
  const api = useApi()
  // The gap between this machine's clock and the server's, measured at each read (half the round
  // trip is taken off), so the countdown here agrees with the wall's.
  const [offsetMs, setOffsetMs] = useState(0)
  const load = useCallback(
    async (signal: AbortSignal) => {
      const sentAt = Date.now()
      const response = await api.getChallenge(slug, signal)
      setOffsetMs(serverOffsetMs(response.serverNowMs, sentAt, Date.now()))
      return response
    },
    [api, slug],
  )
  return { ...useLoader(load), offsetMs }
}

/**
 * The event's shared gallery link (roadmap §4.1): its status, never its address — only the
 * token's digest is stored, so the address exists once, in the answer to making it.
 */
export const useShareLink = (slug: string): LoaderState<ShareLinkResponse> => {
  const api = useApi()
  const load = useCallback((signal: AbortSignal) => api.shareLink(slug, signal), [api, slug])
  return useLoader(load)
}
