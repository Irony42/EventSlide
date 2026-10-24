import { DisplayName } from '../../../domain/guests/displayName'
import type { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'

/**
 * A guest changing the name their photos are signed with — their own, and nobody else's.
 *
 * The name is projected in front of a room, so being able to edit another guest's would
 * be a way to put words under somebody else's photo. The acting guest comes from the
 * verified device token and the target from the request, and they must be the same row.
 *
 * **Only while the event accepts uploads**, the answer an upload gets after the host closes the
 * event (`409 event.notAcceptingUploads`). That name is printed on the wall of a closed event, and
 * an unmoderated guest could otherwise change the credit under photographs the host had approved
 * after the host had closed it, with no signal to the host and no tool to blank it. Asking
 * `acceptsUploads()` is the same rule an upload is held to, so the two cannot disagree about when a
 * guest may still sign something.
 */

export interface RenameGuestInput {
  readonly eventId: EventId
  /** The guest the verified device token names. */
  readonly actingGuestId: GuestId
  /** The guest the request asks to rename. */
  readonly guestId: GuestId
  /** `null` or blank is how a guest takes their name back off the wall. */
  readonly displayName: string | null
}

export interface RenameGuestDeps {
  readonly guests: GuestRepository
  readonly events: EventRepository
}

export type RenameGuest = (input: RenameGuestInput) => Promise<Result<Guest, DomainError>>

export const makeRenameGuest =
  ({ guests, events }: RenameGuestDeps): RenameGuest =>
  async ({ eventId, actingGuestId, guestId, displayName }) => {
    // Checked before the read, so a guest cannot use this endpoint to learn which guest
    // ids exist. `auth.forbidden` rather than a new code: the caller learns only that
    // they may not do this, which is all they can act on.
    if (actingGuestId !== guestId) return err(DomainError.forbidden('auth.forbidden'))

    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    if (!event.acceptsUploads()) {
      return err(DomainError.conflict('event.notAcceptingUploads', { status: event.status }))
    }

    // Scoped by event, so the same guest id at another event genuinely misses.
    const guest = await guests.findById(eventId, guestId)
    if (guest === null) return err(DomainError.notFound('guest.notFound'))

    const parsed = DisplayName.createOptional(displayName)
    if (!parsed.ok) return parsed

    // The rule about a revoked guest lives in the entity, not here.
    const renamed = guest.rename(parsed.value)
    if (!renamed.ok) return renamed

    await guests.save(renamed.value)
    return ok(renamed.value)
  }
