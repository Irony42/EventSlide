import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MembershipRepository } from '../../ports/userRepository'
import { mintGuestInviteToken, openGuestInvite, recordGuestInviteAct } from './guestInviteAccess'
import type { HostGuestInvite } from './getGuestInvite'

/**
 * "Changer le lien": the owner mints a new token (spec 29). **The old link stops at once**, and
 * so does every QR printed with it: the lever for an invitation that circulates where it should
 * not. The switch and the text are untouched, and so is the join code (changing one never changes
 * the other).
 *
 * No invitation yet is `404 guestInvite.notFound`.
 */

export interface RotateGuestInviteTokenInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface RotateGuestInviteTokenDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly invites: GuestInviteRepository
  readonly audit: AuditRecorder
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type RotateGuestInviteToken = (
  input: RotateGuestInviteTokenInput,
) => Promise<Result<HostGuestInvite, DomainError>>

export const makeRotateGuestInviteToken =
  ({
    events,
    memberships,
    invites,
    audit,
    ids,
    clock,
  }: RotateGuestInviteTokenDeps): RotateGuestInviteToken =>
  async ({ eventId, actorId }) => {
    const opened = await openGuestInvite({ events, memberships }, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const event = opened.value

    const current = await invites.findByEvent(eventId)
    if (current === null) return err(DomainError.notFound('guestInvite.notFound'))

    const token = mintGuestInviteToken(ids)
    if (!token.ok) return token
    const now = clock.now()
    const recorded = await recordGuestInviteAct(
      audit,
      event,
      actorId,
      'event.guestInviteRotated',
      now,
    )
    if (!recorded.ok) return recorded
    const rotated = current.rotate(token.value, now)
    await invites.save(rotated)
    return ok({ event, invite: rotated })
  }
