import type { Event } from '../../../domain/events/event'
import type { GuestInvite } from '../../../domain/guestInvites/guestInvite'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { openGuestInvite } from './guestInviteAccess'

/**
 * The host's reading of the event's guest invitation (spec 29): the saved text, the switch and the
 * link. `invite` is `null` until the host first saves or switches it on: nothing is created by a
 * read, and the page then offers the blanks the event itself can fill (its name, its date).
 */

export interface GetGuestInviteInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface HostGuestInvite {
  readonly event: Event
  readonly invite: GuestInvite | null
}

export interface GetGuestInviteDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly invites: GuestInviteRepository
}

export type GetGuestInvite = (
  input: GetGuestInviteInput,
) => Promise<Result<HostGuestInvite, DomainError>>

export const makeGetGuestInvite =
  ({ events, memberships, invites }: GetGuestInviteDeps): GetGuestInvite =>
  async ({ eventId, actorId }) => {
    const opened = await openGuestInvite({ events, memberships }, eventId, actorId, 'read')
    if (!opened.ok) return opened

    return ok({ event: opened.value, invite: await invites.findByEvent(eventId) })
  }
