import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { openGuestInvite, recordGuestInviteAct } from './guestInviteAccess'
import type { HostGuestInvite } from './getGuestInvite'

/**
 * "Désactiver": the owner switches the link off (spec 29). The public page answers "not
 * available" from then on; the text and the token stay, so switching on again gives the same link
 * back to a host who did it by mistake after printing the cards.
 *
 * No invitation yet is `404 guestInvite.notFound`. Switching off one that is off is `ok` with **no
 * write and no audit line**.
 */

export interface DisableGuestInviteInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface DisableGuestInviteDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly invites: GuestInviteRepository
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type DisableGuestInvite = (
  input: DisableGuestInviteInput,
) => Promise<Result<HostGuestInvite, DomainError>>

export const makeDisableGuestInvite =
  ({ events, memberships, invites, audit, clock }: DisableGuestInviteDeps): DisableGuestInvite =>
  async ({ eventId, actorId }) => {
    const opened = await openGuestInvite({ events, memberships }, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const event = opened.value

    const current = await invites.findByEvent(eventId)
    if (current === null) return err(DomainError.notFound('guestInvite.notFound'))
    if (!current.enabled) return ok({ event, invite: current })

    const now = clock.now()
    const recorded = await recordGuestInviteAct(
      audit,
      event,
      actorId,
      'event.guestInviteDisabled',
      now,
    )
    if (!recorded.ok) return recorded
    const disabled = current.disable(now)
    await invites.save(disabled)
    return ok({ event, invite: disabled })
  }
