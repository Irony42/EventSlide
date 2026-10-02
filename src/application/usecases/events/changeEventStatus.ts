import type { Event } from '../../../domain/events/event'
import { canManageEvent } from '../../../domain/events/eventRole'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { clientContextOf } from '../clients/clientContextOf'

/**
 * Open the doors, close the party, archive the album.
 *
 * The legality of a transition is not decided here — `Event.transitionTo` owns the
 * table, and it is also what stamps `closedAt` and therefore starts the retention
 * clock, stamps `openedAt` on the first opening, and refuses an opening the client's
 * ceilings do not allow. This use case authorizes, persists and announces; re-implementing the table
 * would give the projector and the console two different ideas of what `archived` means.
 *
 * Owner only: `closed` stops every guest upload and `archived` is terminal.
 */

export interface ChangeEventStatusInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly status: EventStatus
}

export interface ChangeEventStatusDeps {
  readonly events: EventRepository
  /**
   * For the ceilings of the event's client (roadmap §10.5): `live_allowed` and
   * `max_live_days`. Read only for an event that has a client — see `clientContextOf`.
   */
  readonly clients: ClientRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export type ChangeEventStatus = (
  input: ChangeEventStatusInput,
) => Promise<Result<Event, DomainError>>

export const makeChangeEventStatus =
  ({ events, clients, memberships, bus, clock }: ChangeEventStatusDeps): ChangeEventStatus =>
  async ({ eventId, actorId, status }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    // `notFound` rather than `forbidden` for a caller with no part in the event, so
    // this cannot be used to discover that the event exists.
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    // The client's ceilings go **into** the transition: whether an event may go live is the
    // entity's rule (`live_allowed`, and the window `opened_at + max_live_days` that bounds
    // `closed → live`), so it answers with the same error from here and from the schedule
    // sweep. `null` — an event with no client — is today's lifecycle, unchanged.
    const ceilings = (await clientContextOf(clients, event))?.ceilings ?? null
    const updated = event.transitionTo(status, clock.now(), ceilings)
    if (!updated.ok) return updated

    await events.save(updated.value)
    // The wall listens for this: a projector left running unattended has to notice on
    // its own that the event it is playing was closed or archived.
    bus.publish({
      type: 'event.statusChanged',
      eventId: updated.value.id,
      status: updated.value.status,
    })

    return ok(updated.value)
  }
