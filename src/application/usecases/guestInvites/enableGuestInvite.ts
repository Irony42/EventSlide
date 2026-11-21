import { GuestInvite } from '../../../domain/guestInvites/guestInvite'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MembershipRepository } from '../../ports/userRepository'
import { mintGuestInviteToken, openGuestInvite, recordGuestInviteAct } from './guestInviteAccess'
import type { HostGuestInvite } from './getGuestInvite'

/**
 * "Activer l'invitation": the owner switches the link on (spec 29). It needs a date to announce
 * (`400 guestInvite.needsDate`), so the page cannot go out empty. Switching on an invitation that
 * is already on is `ok` with **no write and no audit line**: a second tap and a retry on a bad
 * connection are not acts.
 *
 * The first activation creates the row when the host never saved one; it then fails for the lack of
 * a date, and nothing is written.
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
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type EnableGuestInvite = (
  input: EnableGuestInviteInput,
) => Promise<Result<HostGuestInvite, DomainError>>

export const makeEnableGuestInvite =
  ({ events, memberships, invites, audit, ids, clock }: EnableGuestInviteDeps): EnableGuestInvite =>
  async ({ eventId, actorId }) => {
    const opened = await openGuestInvite({ events, memberships }, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const event = opened.value
    const now = clock.now()

    let current = await invites.findByEvent(eventId)
    if (current === null) {
      const token = mintGuestInviteToken(ids)
      if (!token.ok) return token
      current = GuestInvite.blank(eventId, token.value, event.settings.wallLanguage, now)
    }
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
    await invites.save(enabled.value)
    return ok({ event, invite: enabled.value })
  }
