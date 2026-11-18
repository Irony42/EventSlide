import { AuditEntry } from '../../../domain/audit/auditEntry'
import { isVoiceOpen } from '../../../domain/events/eventGuestbookVoiceSettings'
import { DomainError } from '../../../domain/shared/errors'
import type { PhotoActor } from '../../../domain/photos/photo'
import type { EventId } from '../../../domain/shared/ids'
import { err, flatMap, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import type { InvalidateExport } from '../exports/invalidateAlbumExport'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * "Ouvrir maintenant": the owner lifts the secret over the voice messages for good (spec 25,
 * rule 10).
 *
 * **Owner only** (`manage`, so a moderator is `403 auth.forbidden` and a stranger `404`). A couple
 * who keeps the voices secret to keep the surprise often hands the `moderator` role to a DJ or a
 * witness; an opening is irreversible and would otherwise be one tap away from them. A moderator
 * can still decide on a message without hearing it, which is enough to run the evening.
 *
 * It writes **one fact**, `opensAt = now` (the server's, never a value of the request: there is
 * none), the same field the settings page writes and that `voiceSettingsViolation` makes one-way.
 * **Idempotent**: a secret already lifted (not sealed at all, an `opensAt` that has come, or an
 * event that is closed) is `ok` with **no write, no audit line and no signal**: a second tap, a
 * retry on a bad connection and a second owner's tap are all the same non-event.
 *
 * What the opening does is let the recordings be heard, and let the archive carry them, so it
 * retires the verified archive the box may hold (an archive written while the secret was on does
 * not contain them) **before** the settings are written, and tells the console, which is the only
 * thing that reads (`guestbook.voice`: the wall hears nothing).
 *
 * Audited, write-ahead like every owner's act on an event: who, and that it happened, never a word
 * of content (`event.voiceOpened`).
 */

export interface OpenGuestbookVoiceInput {
  readonly eventId: EventId
  /** From the session; a guest is refused outright. */
  readonly actor: PhotoActor
}

export interface OpenGuestbookVoiceDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly clock: Clock
  readonly invalidateExport: InvalidateExport
}

export type OpenGuestbookVoice = (
  input: OpenGuestbookVoiceInput,
) => Promise<Result<void, DomainError>>

export const makeOpenGuestbookVoice =
  ({
    events,
    memberships,
    audit,
    bus,
    clock,
    invalidateExport,
  }: OpenGuestbookVoiceDeps): OpenGuestbookVoice =>
  async ({ eventId, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    if (actor.kind === 'guest') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }
    const actorId = actor.userId

    const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    const now = clock.now()
    // Already open, whichever way: nothing to write, nothing to say.
    if (isVoiceOpen(event.settings.guestbookVoice, event, now)) return ok(undefined)

    const entry = AuditEntry.create({
      at: now,
      actor: { kind: 'member', userId: actorId },
      action: 'event.voiceOpened',
      subject: { type: 'event', id: event.id },
      clientId: event.clientId,
      details: {},
    })
    if (!entry.ok) return entry
    await audit.record(entry.value)

    // Retired before the settings change, so an archive never outlives the secret it was written
    // under: a failure here leaves an archive needlessly stale, never one that omits what is heard.
    await invalidateExport(eventId, 'guestbookChanged')

    // **Read again, saved with no await between**: the copy above is older than the awaits, and
    // `events.save` rewrites the row, which would erase a logo written in the gap.
    const current = await events.findById(eventId)
    if (current === null) return err(DomainError.notFound('event.notFound'))
    const updated = flatMap(
      current.settings.with({ guestbookVoice: { opensAtMs: now.getTime() } }),
      (settings) => current.withSettings(settings),
    )
    if (!updated.ok) return updated

    await events.save(updated.value)
    bus.publish({ type: 'guestbook.voice', eventId })
    return ok(undefined)
  }
