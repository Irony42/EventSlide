import type { Event } from '../../../domain/events/event'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'
import { allocateJoinCode } from './allocateJoinCode'

/**
 * The emergency lever: a join link is circulating outside the venue, or a printed card
 * was photographed and posted. Rotating invalidates the old code immediately — there is
 * no grace period, because the whole point is that whoever holds it stops getting in.
 *
 * Owner only. A moderator who could rotate the code could invalidate the cards on every
 * table mid-reception.
 */

export interface RotateJoinCodeInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface RotateJoinCodeDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly ids: IdGenerator
  readonly bus: EventBus
  /**
   * `JOIN_CODE_LENGTH` (P4-09 / D-14), 6 to 10. The rotated code is minted at the
   * box's **current** configuration, which may differ from the length the event's old
   * code was given — nothing requires every code on a box to be the same length,
   * `JoinCode.create` accepts the whole range on the way back in.
   */
  readonly joinCodeLength: number
}

export type RotateJoinCode = (input: RotateJoinCodeInput) => Promise<Result<Event, DomainError>>

export const makeRotateJoinCode =
  ({ events, memberships, ids, bus, joinCodeLength }: RotateJoinCodeDeps): RotateJoinCode =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    const joinCode = await allocateJoinCode(events, ids, joinCodeLength)
    if (!joinCode.ok) return joinCode

    const updated = event.rotateJoinCode(joinCode.value)
    if (!updated.ok) return updated

    await events.save(updated.value)
    // There is no join-code fact on the bus, and there should not be: the code is a
    // credential, and a broadcast carrying it would hand it to every phone already
    // subscribed. `settingsChanged` is the "refetch the event" signal the host console
    // already listens to, which is exactly what has to happen — the QR code on screen
    // is now wrong.
    bus.publish({ type: 'event.settingsChanged', eventId: updated.value.id })

    return ok(updated.value)
  }
