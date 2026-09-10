import { useCallback } from 'react'
import { useApi } from '../../../app/ApiProvider'
import { useAction, type ActionState } from './useAction'
import type { CreateEventInput } from '../../../lib/api/client'
import type { EventDto, EventSettingsDto, EventStatus, ModeratorDto } from '../../../lib/api/dto'

/**
 * The writes the admin surface needs, one hook per endpoint.
 *
 * They exist so no page imports the API singleton or calls `useApi()` itself: the
 * boundary is what makes every screen below testable with a fake, and it is why the
 * 1.0 admin page could only be exercised against a running server.
 */

export const useCreateEvent = (): ActionState<[CreateEventInput], EventDto> => {
  const api = useApi()
  return useAction(useCallback((input: CreateEventInput) => api.createEvent(input), [api]))
}

export const useStatusChange = (): ActionState<[string, EventStatus], EventDto> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, status: EventStatus) => api.setEventStatus(slug, status), [api]),
  )
}

export const useRotateJoinCode = (): ActionState<[string], EventDto> => {
  const api = useApi()
  return useAction(useCallback((slug: string) => api.rotateJoinCode(slug), [api]))
}

export const usePurgeEvent = (): ActionState<[string], void> => {
  const api = useApi()
  return useAction(useCallback((slug: string) => api.purgeEvent(slug), [api]))
}

export const useSaveSettings = (): ActionState<[string, Partial<EventSettingsDto>], EventDto> => {
  const api = useApi()
  return useAction(
    useCallback(
      (slug: string, settings: Partial<EventSettingsDto>) => api.updateSettings(slug, settings),
      [api],
    ),
  )
}

export const useRevokeGuest = (): ActionState<[string, string], void> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, guestId: string) => api.revokeGuest(slug, guestId), [api]),
  )
}

export const useInviteModerator = (): ActionState<[string, string], ModeratorDto> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, email: string) => api.inviteModerator(slug, email), [api]),
  )
}

export const useRevokeModerator = (): ActionState<[string, string], void> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, userId: string) => api.revokeModerator(slug, userId), [api]),
  )
}
