import type { Event } from '../../../domain/events/event'
import { canManageEvent } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { JoinCode } from '../../../domain/shared/joinCode'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The emergency lever: a join link is circulating outside the venue, or a printed card
 * was photographed and posted. Rotating invalidates the old code immediately — there is
 * no grace period, because the whole point is that whoever holds it stops getting in.
 *
 * Owner only. A moderator who could rotate the code could invalidate the cards on every
 * table mid-reception.
 */

/** Same bound and same reason as `createEvent`: a stuck generator must fail, not spin. */
const MAX_JOIN_CODE_ATTEMPTS = 5

export interface RotateJoinCodeInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface RotateJoinCodeDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly ids: IdGenerator
  readonly bus: EventBus
}

export type RotateJoinCode = (input: RotateJoinCodeInput) => Promise<Result<Event, DomainError>>

/**
 * A code no other event on the box holds.
 *
 * `/join/:code` resolves without knowing the event, so the code is unique across all
 * of them and the unique index would make `save` throw instead of returning a
 * `Result`. Asking first turns a collision into a retry.
 */
const allocateJoinCode = async (
  events: EventRepository,
  ids: IdGenerator,
): Promise<Result<JoinCode, DomainError>> => {
  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const candidate = JoinCode.fromBytes(ids.bytes(JoinCode.entropyBytes))
    if (!candidate.ok) return candidate
    if (!(await events.joinCodeTaken(candidate.value))) return ok(candidate.value)
  }
  return err(
    DomainError.unexpected('event.joinCodeExhausted', { attempts: MAX_JOIN_CODE_ATTEMPTS }),
  )
}

export const makeRotateJoinCode =
  ({ events, memberships, ids, bus }: RotateJoinCodeDeps): RotateJoinCode =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    // `notFound` rather than `forbidden` for a caller with no part in the event, so
    // this cannot be used to discover that the event exists.
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    const joinCode = await allocateJoinCode(events, ids)
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
