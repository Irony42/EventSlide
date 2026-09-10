import { DisplayName } from '../../../domain/guests/displayName'
import type { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { GuestRepository } from '../../ports/guestRepository'

/**
 * A guest changing the name their photos are signed with — their own, and nobody else's.
 *
 * The name is projected in front of a room, so being able to edit another guest's would
 * be a way to put words under somebody else's photo. The acting guest comes from the
 * verified device token and the target from the request, and they must be the same row.
 *
 * Deliberately says nothing about the event lifecycle. A guest at a closed party may
 * still correct the spelling of their own name on an album that is still being viewed;
 * "may this happen now" is a question about uploading, and it is asked there.
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
}

export type RenameGuest = (input: RenameGuestInput) => Promise<Result<Guest, DomainError>>

export const makeRenameGuest =
  ({ guests }: RenameGuestDeps): RenameGuest =>
  async ({ eventId, actingGuestId, guestId, displayName }) => {
    // Checked before the read, so a guest cannot use this endpoint to learn which guest
    // ids exist. `auth.forbidden` rather than a new code: the caller learns only that
    // they may not do this, which is all they can act on.
    if (actingGuestId !== guestId) return err(DomainError.forbidden('auth.forbidden'))

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
