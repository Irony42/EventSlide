import type { Event } from '../../../domain/events/event'
import { DisplayName } from '../../../domain/guests/displayName'
import { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
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
 *
 * ## Joining twice is still one guest
 *
 * A join is idempotent per device: a request that presents a device token this event
 * already issued updates **that** guest rather than minting a second one. The device
 * token is the guest's identity, so one phone is one guest no matter how many times it
 * arrives — and it arrives more than once in practice. A guest re-opens the link from
 * their camera roll an hour later, double-taps *Rejoindre* on venue Wi-Fi, or reloads
 * the join page; every one of those used to hand them a fresh guest row and orphan the
 * old one, which cost them the photos listed on their own screen, the grace window in
 * which they may delete a photo they regret, and their share of `maxPhotosPerGuest` —
 * and left the host counting one person twice in a guest list that is meant to read as
 * "who is in the room".
 */

export interface JoinEventInput {
  /** As typed or scanned. Case, separators and confusables are folded by the domain. */
  readonly joinCode: string
  /** Absent, `null` or blank all mean an anonymous guest, which is allowed. */
  readonly displayName?: string | null
  /**
   * The device token this phone already holds, verbatim from its cookie. Absent on a
   * first join, and untrusted: it is verified here, and honoured only when it names
   * *this* event and a guest row that still exists and is still allowed in.
   */
  readonly deviceToken?: string
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

export const makeJoinEvent = ({
  events,
  guests,
  tokens,
  ids,
  clock,
  bus,
}: JoinEventDeps): JoinEvent => {
  /**
   * The guest a presented device token already stands for at this event, or `null` when
   * the request has no usable identity yet.
   *
   * Every reason to answer `null` ends the same way — a new guest — so none of them is
   * reported: a stranger posting a guessed token learns nothing beyond what an empty
   * cookie jar would have told them. The event scope is the load-bearing check. A token
   * issued for the gala must not reach a wedding guest row, which is the same rule the
   * guest middleware enforces as `guest.wrongEvent`; here there is no principal to
   * refuse, so the token is simply not this device's identity at this event.
   *
   * A revoked guest falls through to a new row, exactly as before: revocation is a
   * question about the token the host cut off, and answering it here would turn the
   * front door into the place that explains why somebody is not welcome.
   */
  const deviceGuest = async (
    eventId: EventId,
    presented: string | undefined,
    now: Date,
  ): Promise<Guest | null> => {
    if (presented === undefined) return null

    const claims = tokens.verify(presented, now)
    if (!claims.ok || claims.value.eventId !== eventId) return null

    // The row may be gone — the event was purged and recreated — and a signed token
    // outliving its guest grants nothing.
    const guest = await guests.findById(eventId, claims.value.guestId)
    if (guest === null || guest.isRevoked()) return null
    return guest
  }

  return async (input) => {
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
    const device = await deviceGuest(event.id, input.deviceToken, now)

    // Chained rather than narrowed twice: neither `Guest.create` nor a rename of a
    // guest already known to be active can fail today, and an `if` on a `Result` that
    // is always `ok` is a branch no test can reach — while the shape still carries a
    // future rule out of the entity unchanged. Chaining also means a rejected name
    // consumes no guest id.
    const joined = flatMap(DisplayName.createOptional(input.displayName), (displayName) => {
      if (device === null) {
        return Guest.create({ eventId: event.id, displayName }, ids.guestId(), now)
      }
      // No name in the request means the guest did not say, not that they want the
      // name they already gave taken off the wall. The join page re-submits the code
      // on its own to resolve the event, so reading silence as "anonymous" would
      // un-sign a returning guest's photos without anybody asking for it. Going
      // anonymous on purpose is a rename.
      return displayName === null ? ok(device) : device.rename(displayName)
    })
    if (!joined.ok) return joined

    // Joining is itself an activity: a guest who scans the code and never uploads still
    // belongs in the host's count of who is in the room. A no-op on a guest created a
    // line ago, and the whole point of a re-join for one who arrived an hour ago.
    const guest = joined.value.touch(now)

    await guests.save(guest)
    const token = tokens.issue({ eventId: event.id, guestId: guest.id, issuedAt: now })
    // After the row exists: a host must never be shown a guest who failed to persist.
    // Announced on a re-join too — the stream carries invalidations rather than deltas,
    // and a name added on a second join has to reach the console that is showing the
    // guest list right now.
    bus.publish({ type: 'guest.joined', eventId: event.id, guestId: guest.id })

    return ok({ token, guestId: guest.id, displayName: guest.label(), event })
  }
}
