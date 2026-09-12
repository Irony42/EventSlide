import { useCallback } from 'react'
import { useApi } from '../../../app/useApi'
import { useAction, type ActionState } from './useAction'
import type {
  CreateEventInput,
  EventScheduleInput,
  ModeratorInvitationInput,
  ModeratorInviteResponse,
} from '../../../lib/api/client'
import type { EventDto, EventSettingsDto, EventStatus } from '../../../lib/api/dto'

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

/**
 * Separate from `useSaveSettings` because they are two endpoints and two rules: the
 * schedule lives on the event itself, not in `EventSettings`, and its refusals —
 * "a closing before an opening" — belong to the aggregate, not to the settings value
 * object.
 */
export const useSaveSchedule = (): ActionState<[string, EventScheduleInput], EventDto> => {
  const api = useApi()
  return useAction(
    useCallback(
      (slug: string, schedule: EventScheduleInput) => api.setSchedule(slug, schedule),
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

/**
 * The whole invitation, not just the address.
 *
 * The temporary password travels with it because the server requires one and there is
 * no mailer to send it: the host reads it out. Threading it through as part of the input
 * object keeps the hook from having to know which of two strings is which.
 */
export const useInviteModerator = (): ActionState<
  [string, ModeratorInvitationInput],
  ModeratorInviteResponse
> => {
  const api = useApi()
  return useAction(
    useCallback(
      (slug: string, input: ModeratorInvitationInput) => api.inviteModerator(slug, input),
      [api],
    ),
  )
}

export const useRevokeModerator = (): ActionState<[string, string], void> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, userId: string) => api.revokeModerator(slug, userId), [api]),
  )
}
