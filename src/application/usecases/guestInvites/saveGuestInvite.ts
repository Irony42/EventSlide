import { GuestInvite } from '../../../domain/guestInvites/guestInvite'
import type { GuestInviteContentPatch } from '../../../domain/guestInvites/guestInviteContent'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MembershipRepository } from '../../ports/userRepository'
import { mintGuestInviteToken, openGuestInvite, recordGuestInviteAct } from './guestInviteAccess'
import type { HostGuestInvite } from './getGuestInvite'

/**
 * The owner writes the invitation (spec 29): title, moment, place, word, language. **An absent
 * field is left as it was, `null` clears it**; the domain parses every field, one code each.
 *
 * The first save creates the row, switched **off**, with a fresh token and the event's wall language
 * unless the save names another: a link exists from then on but answers nothing until the host
 * switches it on. Saving never changes the switch or the token.
 *
 * Audited (`event.guestInviteSaved`, no content), write-ahead, once the content is known to be
 * valid: a refused save leaves no line.
 */

export interface SaveGuestInviteInput extends GuestInviteContentPatch {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface SaveGuestInviteDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly invites: GuestInviteRepository
  readonly audit: AuditRecorder
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type SaveGuestInvite = (
  input: SaveGuestInviteInput,
) => Promise<Result<HostGuestInvite, DomainError>>

export const makeSaveGuestInvite =
  ({ events, memberships, invites, audit, ids, clock }: SaveGuestInviteDeps): SaveGuestInvite =>
  async ({ eventId, actorId, ...patch }) => {
    const opened = await openGuestInvite({ events, memberships }, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const event = opened.value
    const now = clock.now()

    let current = await invites.findByEvent(eventId)
    if (current === null) {
      const token = mintGuestInviteToken(ids)
      if (!token.ok) return token
      current = GuestInvite.blank(eventId, token.value, event.settings.wallLanguage, now)
    }

    const saved = current.withContent(patch, now)
    if (!saved.ok) return saved

    const recorded = await recordGuestInviteAct(
      audit,
      event,
      actorId,
      'event.guestInviteSaved',
      now,
    )
    if (!recorded.ok) return recorded
    await invites.save(saved.value)
    return ok({ event, invite: saved.value })
  }
