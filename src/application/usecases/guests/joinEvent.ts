import type { Event } from '../../../domain/events/event'
import { DisplayName } from '../../../domain/guests/displayName'
import { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import type { GuestId } from '../../../domain/shared/ids'
import { JoinCode } from '../../../domain/shared/joinCode'
import { err, flatMap, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestTokenService } from '../../ports/guestTokenService'
import type { IdGenerator } from '../../ports/idGenerator'

/**
 * The front door: a guest scans the QR code, lands on `/join/:code`, and walks out with
 * a device token.
 *
 * This is the one endpoint reachable with no credential at all, which shapes two
 * decisions below. First, the code is *normalised* rather than matched literally, so a
 * stranger reading a printed card in a dark room still gets in. Second, an unknown code
 * and an event that is not open to guests get the **same** answer, so the endpoint
 * cannot be used to discover which codes exist.
 *
 * 1.0 put the event name in a query parameter (`?partyname=` on the QR page, `?party`
 * on the upload page), so every guest silently uploaded to a default event. The join
 * code is now resolved server-side to an `EventId` and there is no client-side default
 * to fall back to.
 */

export interface JoinEventInput {
  /** As typed or scanned. Case, separators and confusables are folded by the domain. */
  readonly joinCode: string
  /** Absent, `null` or blank all mean an anonymous guest, which is allowed. */
  readonly displayName?: string | null
}

export interface JoinEventOutput {
  /** For the `HttpOnly; SameSite=Lax` cookie. The use case never sees a cookie. */
  readonly token: string
  readonly guestId: GuestId
  /** As stored, so the guest sees the name the wall will show. `null` if anonymous. */
  readonly displayName: string | null
  /** Narrowed to what a guest may know by the presenter; a use case owns no wire format. */
  readonly event: Event
}

export interface JoinEventDeps {
  readonly events: EventRepository
  readonly guests: GuestRepository
  readonly tokens: GuestTokenService
  readonly ids: IdGenerator
  readonly clock: Clock
  readonly bus: EventBus
}

export type JoinEvent = (input: JoinEventInput) => Promise<Result<JoinEventOutput, DomainError>>

export const makeJoinEvent =
  ({ events, guests, tokens, ids, clock, bus }: JoinEventDeps): JoinEvent =>
  async (input) => {
    const code = JoinCode.create(input.joinCode)
    // The *shape* of a code is safe to report: `joinCode.wrongLength` tells a guest to
    // count the characters again, and a string that could never be stored says nothing
    // about the codes that are.
    if (!code.ok) return code

    const event = await events.findByJoinCode(code.value)
    // One answer for "no such code" and for "not open to guests", in one expression so
    // the two cannot drift apart. A distinguishable "not started yet" would confirm
    // that a guessed code belongs to a real event.
    if (event === null || !event.acceptsGuests()) {
      return err(DomainError.notFound('event.notFound'))
    }

    const now = clock.now()
    // Chained rather than narrowed twice: `Guest.create` cannot fail today, and an `if`
    // on a `Result` that is always `ok` is a branch no test can reach — while the shape
    // still carries a future rule out of the entity unchanged. Chaining also means a
    // rejected name consumes no guest id.
    const created = flatMap(DisplayName.createOptional(input.displayName), (displayName) =>
      Guest.create({ eventId: event.id, displayName }, ids.guestId(), now),
    )
    if (!created.ok) return created
    const guest = created.value

    await guests.save(guest)
    const token = tokens.issue({ eventId: event.id, guestId: guest.id, issuedAt: now })
    // After the row exists: a host must never be shown a guest who failed to persist.
    bus.publish({ type: 'guest.joined', eventId: event.id, guestId: guest.id })

    return ok({ token, guestId: guest.id, displayName: guest.label(), event })
  }
