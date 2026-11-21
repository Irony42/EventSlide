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
 * "Activer l'invitation": the owner switches the link on (spec 29). It needs a date to announce
 * (`400 guestInvite.needsDate`), so the page cannot go out empty. Switching on an invitation that
 * is already on is `ok` with **no write and no audit line**: a second tap and a retry on a bad
 * connection are not acts.
 *
 * Before anything was saved there is no row and no date: `400 guestInvite.needsDate`, and nothing
 * is created.
 */

export interface EnableGuestInviteInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface EnableGuestInviteDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly invites: GuestInviteRepository
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type EnableGuestInvite = (
  input: EnableGuestInviteInput,
) => Promise<Result<HostGuestInvite, DomainError>>

export const makeEnableGuestInvite =
  ({ events, memberships, invites, audit, clock }: EnableGuestInviteDeps): EnableGuestInvite =>
  async ({ eventId, actorId }) => {
    const opened = await openGuestInvite({ events, memberships }, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const event = opened.value
    const now = clock.now()

    // Nothing was ever saved: there is no date to announce, and nothing is created by asking.
    const current = await invites.findByEvent(eventId)
    if (current === null) return err(DomainError.invalid('guestInvite.needsDate'))
    if (current.enabled) return ok({ event, invite: current })

    const enabled = current.enable(now)
    if (!enabled.ok) return enabled

    const recorded = await recordGuestInviteAct(
      audit,
      event,
      actorId,
      'event.guestInviteEnabled',
      now,
    )
    if (!recorded.ok) return recorded
    await invites.setEnabled(eventId, true, now)
    return ok({ event, invite: enabled.value })
  }
