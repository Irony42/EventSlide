import type { Event } from '../../../domain/events/event'
import {
  canDeleteEvent,
  canInviteModerators,
  canManageEvent,
  canModerate,
  type EventRole,
} from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * What an actor must be able to do in an event, and the one place that says how a caller who
 * cannot is answered.
 *
 * Twenty-one use cases opened with the same eight lines, each with its own comment re-arguing
 * the same two choices. Both choices live here now:
 *
 * - **No membership is the same answer as an event that does not exist** (`event.notFound`).
 *   Confirming that an event exists to someone with no part in it turns the endpoint into an
 *   enumeration oracle for other people's weddings; `requireRole` makes the same choice at the
 *   HTTP boundary. It is also why the role is read by `(eventId, actorId)` and nothing wider:
 *   an owner of the corporate gala is nobody on this wedding.
 * - **A member who is not enough is told so** (`403 auth.forbidden`, `required: 'owner'`) for
 *   what only the host may do. A moderator of this event is genuinely in scope, so `forbidden`
 *   is honest and reveals nothing they did not already know. Moderating is the exception: a
 *   role that cannot moderate is answered `notFound` too, because there is nothing it is
 *   entitled to know about the queue.
 *
 * The requirement is named after the capability, never after the roles that qualify, so a
 * role added later is refused by default instead of silently inheriting it. Both of today's
 * roles moderate, so the second half of that condition is a guard against a future rather than
 * a branch an event can take, and it is written once here instead of six times.
 *
 * What stays in the use case: reading the event (not every one needs it), and any rule about
 * its state (`requireEditable`) — **asked after this one, never before**: a refusal that names the
 * event's state (`event.immutable`, `status: 'archived'`) to a caller with no part in it would
 * confirm the event exists, which is the oracle the first choice above closes.
 */

export type RoleRequirement = 'moderate' | 'manage' | 'delete' | 'inviteModerators'

const notFound = (): DomainError => DomainError.notFound('event.notFound')

const forbidden = (): DomainError => DomainError.forbidden('auth.forbidden', { required: 'owner' })

const REQUIREMENTS: Readonly<
  Record<
    RoleRequirement,
    { readonly allows: (role: EventRole) => boolean; readonly refusal: () => DomainError }
  >
> = {
  moderate: { allows: canModerate, refusal: notFound },
  manage: { allows: canManageEvent, refusal: forbidden },
  delete: { allows: canDeleteEvent, refusal: forbidden },
  inviteModerators: { allows: canInviteModerators, refusal: forbidden },
}

export const requireEventRole = async (
  memberships: Pick<MembershipRepository, 'roleFor'>,
  eventId: EventId,
  actorId: UserId,
  requirement: RoleRequirement,
): Promise<Result<EventRole, DomainError>> => {
  const role = await memberships.roleFor(eventId, actorId)
  if (role === null) return err(notFound())

  const { allows, refusal } = REQUIREMENTS[requirement]
  return allows(role) ? ok(role) : err(refusal())
}

/**
 * An archived event is a record: nothing about it can be edited any more. The entity says
 * which statuses those are (`allowsEditing`); this says how the refusal is shaped, once.
 */
export const requireEditable = (event: Event): Result<Event, DomainError> =>
  event.allowsEditing()
    ? ok(event)
    : err(DomainError.conflict('event.immutable', { status: event.status }))

/**
 * A suspended client's members read and may not write (roadmap §10.7; G2-14): every use case that
 * changes an event on a host's behalf asks this, **after** the role (so a stranger is still told
 * what a stranger is told, and only somebody in scope learns that the client is frozen) and
 * **before** anything else about the request.
 *
 * It used to be a test on the HTTP verb in `requireRole` (a `GET` passed, anything else was
 * refused), which made it a rule no use case knew: a future read that has to be a `POST` would be
 * frozen, a write sent as `GET` would not be, and it could not be exercised below ring 4. The
 * entity answers (`isClientSuspended`); this says how the refusal is shaped, once, with the code
 * the wire has always carried: `403 client.suspended`.
 */
export const requireWritable = (event: Event): Result<Event, DomainError> =>
  event.isClientSuspended() ? err(DomainError.forbidden('client.suspended')) : ok(event)
