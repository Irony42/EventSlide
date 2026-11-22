import { parseRsvpInput, type GuestRsvp, type RawRsvpInput } from '../../../domain/guestRsvps/rsvp'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestRsvpId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import {
  announceRsvpsChanged,
  openRsvps,
  recordRsvpAct,
  requireInvite,
  type RsvpAccessDeps,
} from './rsvpAccess'

/**
 * The host corrects a reply (spec 30). The whole reply is sent again, judged by the form of the
 * moment; the id, the guest's token, the source and the creation instant stay. **Not held to the
 * places**: a host who edits decides. `404 rsvp.notFound` for a reply that is not this event's.
 */

export interface HostUpdateRsvpInput extends RawRsvpInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly rsvpId: GuestRsvpId
}

export interface HostUpdateRsvpDeps extends RsvpAccessDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'findById' | 'update'>
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly clock: Clock
}

export type HostUpdateRsvp = (input: HostUpdateRsvpInput) => Promise<Result<GuestRsvp, DomainError>>

export const makeHostUpdateRsvp =
  (deps: HostUpdateRsvpDeps): HostUpdateRsvp =>
  async ({ eventId, actorId, rsvpId, ...raw }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const needed = requireInvite(opened.value)
    if (!needed.ok) return needed

    const held = await deps.rsvps.findById(eventId, rsvpId)
    if (held === null) return err(DomainError.notFound('rsvp.notFound'))
    const now = deps.clock.now()

    const reply = parseRsvpInput(needed.value.settings.form, raw)
    if (!reply.ok) return reply

    const recorded = await recordRsvpAct(
      deps.audit,
      needed.value.event,
      actorId,
      'event.rsvpHostEdited',
      now,
    )
    if (!recorded.ok) return recorded
    const changed = held.withReply(reply.value, now)
    await deps.rsvps.update(changed)
    announceRsvpsChanged(deps.bus, eventId)
    return ok(changed)
  }
