import { useCallback } from 'react'
import { useApi } from '../../../app/useApi'
import { useAction, type ActionState } from './useAction'
import type {
  CreateEventInput,
  EventScheduleInput,
  MissionInput,
  ModeratorInvitationInput,
  ShareLinkInput,
} from '../../../lib/api/client'
import type {
  EventDto,
  EventSettingsDto,
  EventStatus,
  MissionDto,
  ModeratorInviteResponse,
  ShareLinkCreated,
} from '../../../lib/api/dto'

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
 * A moderator's invitation: the address, and the language the invitation is written in. The
 * person chooses their own name and password when they accept it.
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

/**
 * The three writes on the mission list, one hook each (roadmap §2.1).
 *
 * The edit and the delete answer `204`, so both are `void`: an edit touches no
 * photograph and therefore re-counts none, and padding its response to match the create's
 * shape would put a number on the wire that is false. The panel reloads the list instead.
 */
export const useCreateMission = (): ActionState<[string, MissionInput], MissionDto> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, input: MissionInput) => api.createMission(slug, input), [api]),
  )
}

export const useUpdateMission = (): ActionState<[string, string, MissionInput], void> => {
  const api = useApi()
  return useAction(
    useCallback(
      (slug: string, missionId: string, input: MissionInput) =>
        api.updateMission(slug, missionId, input),
      [api],
    ),
  )
}

export const useDeleteMission = (): ActionState<[string, string], void> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, missionId: string) => api.deleteMission(slug, missionId), [api]),
  )
}

/**
 * The shared gallery link's two writes (roadmap §4.1). Making one replaces the current one
 * on the server, in one transaction, so there is no separate "replace".
 */
export const useCreateShareLink = (): ActionState<[string, ShareLinkInput], ShareLinkCreated> => {
  const api = useApi()
  return useAction(
    useCallback((slug: string, input: ShareLinkInput) => api.createShareLink(slug, input), [api]),
  )
}

export const useRevokeShareLink = (): ActionState<[string], void> => {
  const api = useApi()
  return useAction(useCallback((slug: string) => api.revokeShareLink(slug), [api]))
}

/**
 * The host's own photograph of their venue (ADR 0010, decision 8): put up or replaced, and
 * taken down. Two endpoints, each answering the event, so the settings page shows the
 * photograph's URL (or its absence) with no second read.
 */
export const useUploadVenuePhoto = (): ActionState<[string, File], EventDto> => {
  const api = useApi()
  return useAction(useCallback((slug: string, file: File) => api.putVenuePhoto(slug, file), [api]))
}

export const useRemoveVenuePhoto = (): ActionState<[string], EventDto> => {
  const api = useApi()
  return useAction(useCallback((slug: string) => api.removeVenuePhoto(slug), [api]))
}
