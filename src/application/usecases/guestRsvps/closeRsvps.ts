import { closeRsvps, reopenRsvps } from '../../../domain/guestRsvps/rsvpSettings'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestInviteRepository } from '../../ports/guestInviteRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import { rsvpFormViewOf, type RsvpFormView } from './getRsvpForm'
import {
  announceRsvpsChanged,
  openRsvps,
  recordRsvpAct,
  requireInvite,
  type RsvpAccessDeps,
} from './rsvpAccess'

/**
 * "Fermer les réponses" and "Rouvrir" (spec 30): the host's hand on the window, whatever the
 * deadline says. Closing keeps the **first** closing; closing what is closed, or reopening what is
 * open, writes, audits and announces nothing. Needs the invitation (`409 rsvp.inviteRequired`).
 */

export interface CloseRsvpsInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface CloseRsvpsDeps extends RsvpAccessDeps {
  readonly invites: Pick<
    GuestInviteRepository,
    'findByEvent' | 'findRsvpSettings' | 'setRsvpClosedAt'
  >
  readonly rsvps: Pick<GuestRsvpRepository, 'listByEvent'>
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly clock: Clock
}

export type CloseRsvps = (input: CloseRsvpsInput) => Promise<Result<RsvpFormView, DomainError>>

const makeSwitch =
  (kind: 'close' | 'reopen') =>
  (deps: CloseRsvpsDeps): CloseRsvps =>
  async ({ eventId, actorId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const needed = requireInvite(opened.value)
    if (!needed.ok) return needed
    const { event, settings } = needed.value
    const now = deps.clock.now()

    const changed = kind === 'close' ? closeRsvps(settings, now) : reopenRsvps(settings)
    if (changed.closedAt?.getTime() !== settings.closedAt?.getTime()) {
      const recorded = await recordRsvpAct(
        deps.audit,
        event,
        actorId,
        kind === 'close' ? 'event.rsvpsClosed' : 'event.rsvpsReopened',
        now,
      )
      if (!recorded.ok) return recorded
      await deps.invites.setRsvpClosedAt(eventId, changed.closedAt)
      announceRsvpsChanged(deps.bus, eventId)
    }
    return ok(await rsvpFormViewOf({ ...needed.value, settings: changed }, deps.rsvps, now))
  }

export const makeCloseRsvps = makeSwitch('close')
export const makeReopenRsvps = makeSwitch('reopen')
