import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { AuditAction } from '../../../domain/audit/auditAction'
import type { Event } from '../../../domain/events/event'
import { GuestInviteToken } from '../../../domain/guestInvites/guestInviteToken'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireReadable, requireWritable } from '../shared/eventRole'

/**
 * What every host-side guest invitation use case asks first, in the order the rest of the
 * application keeps (spec 29, section 4.3):
 *
 * 1. the event exists, and the actor is its **owner** (`manage`, the settings' right, not a
 *    moderator's: the invitation carries the address of the party and a link that outlives the
 *    evening). A stranger is told `event.notFound`, a moderator `403 auth.forbidden`;
 * 2. the event is not frozen: a suspended client's host reads nothing and writes nothing
 *    (`403 client.suspended`), an event the operator took down is `404`;
 * 3. for a write, the event is not archived (`409 guestInvite.eventArchived`). A closed event may
 *    still be edited, and so may one whose purge is held: the invitation is the host's own text,
 *    not a guest's contribution.
 *
 * The state of the event is asked **after** the role, never before: a refusal that names it to a
 * caller with no part in it would confirm the event exists.
 */

export interface GuestInviteAccessDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
}

export const openGuestInvite = async (
  { events, memberships }: GuestInviteAccessDeps,
  eventId: EventId,
  actorId: UserId,
  mode: 'read' | 'write',
): Promise<Result<Event, DomainError>> => {
  const event = await events.findById(eventId)
  if (event === null) return err(DomainError.notFound('event.notFound'))

  const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
  if (!allowed.ok) return allowed

  const reachable = mode === 'write' ? requireWritable(event) : requireReadable(event)
  if (!reachable.ok) return reachable

  if (mode === 'write' && !event.allowsEditing()) {
    return err(DomainError.conflict('guestInvite.eventArchived'))
  }
  return ok(event)
}

/** A fresh token from the injected entropy: 16 bytes, 80 bits. */
export const mintGuestInviteToken = (ids: IdGenerator): Result<GuestInviteToken, DomainError> =>
  GuestInviteToken.fromBytes(ids.bytes(GuestInviteToken.length))

/**
 * One line of the audit log for an owner's act on the invitation: who, when, and that it
 * happened. **Never a word of content.** Written before the change, as every owner's act on an
 * event is.
 */
export const recordGuestInviteAct = async (
  audit: AuditRecorder,
  event: Event,
  actorId: UserId,
  action: Extract<
    AuditAction,
    | 'event.guestInviteSaved'
    | 'event.guestInviteEnabled'
    | 'event.guestInviteDisabled'
    | 'event.guestInviteRotated'
  >,
  at: Date,
): Promise<Result<void, DomainError>> => {
  const entry = AuditEntry.create({
    at,
    actor: { kind: 'member', userId: actorId },
    action,
    subject: { type: 'event', id: event.id },
    clientId: event.clientId,
    details: {},
  })
  if (!entry.ok) return entry
  await audit.record(entry.value)
  return ok(undefined)
}
