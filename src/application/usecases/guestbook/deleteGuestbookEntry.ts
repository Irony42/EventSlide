import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, GuestbookEntryId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { GuestbookVoiceRepository } from '../../ports/guestbookVoiceRepository'
import type { MediaStore } from '../../ports/mediaStore'
import { isInAlbum } from '../../../domain/photos/photoStatus'
import type { InvalidateExport } from '../exports/invalidateAlbumExport'
import { makeRemoveVoiceBytes } from './removeVoiceBytes'

/**
 * A guest takes back one of their own messages (spec 01).
 *
 * **The photograph's rule for a written message** (`GuestbookEntry.deletionVerdict`): the host's
 * `allowGuestSelfDelete` switch over the feature, then the author, inside the grace window, while
 * the message is not yet on the wall. A guest who wants a published message gone uses "delete
 * everything I sent" (`eraseGuestContribution`), which this rule does not gate. **A voice message has
 * a rule of its own** (spec 25, rule 1 bis), still the entity's: the grace window whatever its
 * status, and a failed one without condition.
 *
 * **A voice message's bytes go first, then its row** (spec 25, section 10): its output and its
 * source if the worker still holds it, by `removeVoiceBytes`, and only then the entry and its voice.
 * The verified archive the box may hold is retired before anything goes when the message is in it
 * (a voice is, once ready and decided), and the console is told by `guestbook.voice`, the one signal
 * the wall never hears.
 *
 * The lookup is by `(eventId, entryId)` and then by author: another guest's message, another
 * event's and one the operator took down are all the same `guestbook.notFound`, so a guest learns
 * nothing about a message that is not theirs. The purge hold is asked **after** the lookup, so an
 * unknown id stays a 404, and is answered with the generic failure `deletePhoto` gives: the host
 * is not told there is a hold.
 */

export interface DeleteGuestbookEntryInput {
  readonly eventId: EventId
  readonly entryId: GuestbookEntryId
  /** The guest the device token proves. */
  readonly guestId: GuestId
}

export interface DeleteGuestbookEntryDeps {
  readonly events: EventRepository
  readonly guestbook: GuestbookRepository
  /** Removes a voice message's entry and its voice together, after its bytes. */
  readonly voices: Pick<GuestbookVoiceRepository, 'deleteByEntry'>
  readonly media: Pick<MediaStore, 'delete'>
  readonly bus: EventBus
  readonly clock: Clock
  /**
   * Retires the verified archive the box may hold (spec 22) when a message it holds is taken back:
   * a recording published on arrival is in it, so a guest's removal of one must reach the copy.
   * Awaited, and before the bytes go.
   */
  readonly invalidateExport?: InvalidateExport
}

export type DeleteGuestbookEntry = (
  input: DeleteGuestbookEntryInput,
) => Promise<Result<void, DomainError>>

export const makeDeleteGuestbookEntry = ({
  events,
  guestbook,
  voices,
  media,
  bus,
  clock,
  invalidateExport,
}: DeleteGuestbookEntryDeps): DeleteGuestbookEntry => {
  const removeVoiceBytes = makeRemoveVoiceBytes({ media })

  return async ({ eventId, entryId, guestId }) => {
    const event = await events.findById(eventId)
    if (event === null || !event.isReachable()) {
      return err(DomainError.notFound('event.notFound'))
    }

    const entry = await guestbook.findById(eventId, entryId)
    if (entry === null || !entry.isAuthoredBy(guestId)) {
      return err(DomainError.notFound('guestbook.notFound'))
    }

    if (event.isPurgeHeld()) return err(DomainError.unexpected('guestbook.deleteFailed'))

    const verdict = entry.deletionVerdict({ kind: 'guest', guestId }, clock.now(), {
      allowGuestSelfDelete: event.settings.allowGuestSelfDelete,
      guestSelfDeleteGraceMs: event.settings.guestSelfDeleteGraceSeconds * 1_000,
    })
    if (verdict === 'selfDeleteDisabled') {
      return err(DomainError.forbidden('event.guestSelfDeleteDisabled'))
    }
    if (verdict === 'forbidden') return err(DomainError.forbidden('guestbook.deleteForbidden'))

    // Before anything goes, and for a message that is in the archive: a failure here leaves an
    // archive needlessly stale, never one that still holds what the guest took back.
    if (isInAlbum(entry.status) && entry.isDecidable()) {
      await invalidateExport?.(eventId, 'guestbookChanged')
    }

    const voice = entry.voice
    if (voice === null) {
      await guestbook.delete(eventId, entryId)
      bus.publish({ type: 'guestbook.changed', eventId })
      return ok(undefined)
    }

    // The bytes, then the row (spec 25): the row is the only record of where the recording is.
    await removeVoiceBytes(eventId, voice)
    await voices.deleteByEntry(eventId, entryId)
    bus.publish({ type: 'guestbook.voice', eventId })
    return ok(undefined)
  }
}
