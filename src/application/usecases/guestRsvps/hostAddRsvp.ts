import { GuestRsvp, parseRsvpInput, type RawRsvpInput } from '../../../domain/guestRsvps/rsvp'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import {
  announceRsvpsChanged,
  openRsvps,
  recordRsvpAct,
  requireInvite,
  type RsvpAccessDeps,
} from './rsvpAccess'

/**
 * "Ajouter une réponse" (spec 30): the host types the reply of a guest who answered them in person
 * or by message. The reply is judged by the **same form** a guest's is, comes from `host`, has no
 * token to keep, and **is not held to the places** (the host decides): only the thousand-reply
 * ceiling applies, `409 rsvp.tooMany`. Allowed whatever the window says, as long as the event is not
 * archived. Audited without content, and announced.
 */

export interface HostAddRsvpInput extends RawRsvpInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface HostAddRsvpDeps extends RsvpAccessDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'admit'>
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type HostAddRsvp = (input: HostAddRsvpInput) => Promise<Result<GuestRsvp, DomainError>>

export const makeHostAddRsvp =
  (deps: HostAddRsvpDeps): HostAddRsvp =>
  async ({ eventId, actorId, ...raw }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const needed = requireInvite(opened.value)
    if (!needed.ok) return needed
    const now = deps.clock.now()

    const reply = parseRsvpInput(needed.value.settings.form, raw)
    if (!reply.ok) return reply

    const rsvp = GuestRsvp.create({
      id: deps.ids.guestRsvpId(),
      eventId,
      householdId: null,
      editTokenHash: null,
      reply: reply.value,
      source: 'host',
      now,
    })
    const recorded = await recordRsvpAct(
      deps.audit,
      needed.value.event,
      actorId,
      'event.rsvpHostAdded',
      now,
    )
    if (!recorded.ok) return recorded

    const admission = await deps.rsvps.admit(rsvp, { capacity: null })
    if (admission.kind === 'refused') return err(DomainError.conflict('rsvp.tooMany'))
    announceRsvpsChanged(deps.bus, eventId)
    return ok(admission.rsvp)
  }
