import type { Event } from '../../../domain/events/event'
import type { GuestInvite } from '../../../domain/guestInvites/guestInvite'
import type { RsvpSettings } from '../../../domain/guestRsvps/rsvpSettings'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import {
  openRsvps,
  statsAndSituation,
  type OpenedRsvps,
  type RsvpAccessDeps,
  type RsvpSituation,
} from './rsvpAccess'

/**
 * The host's reading of what they asked guests (spec 30): the switch, the deadline, the manual
 * closing, the form, and where the window stands now. Nothing is created by a read: while the event
 * has no invitation the settings are the defaults and `invite` is `null`.
 */

export interface RsvpFormView extends RsvpSituation {
  readonly event: Event
  readonly invite: GuestInvite | null
  readonly settings: RsvpSettings
}

export interface GetRsvpFormInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface GetRsvpFormDeps extends RsvpAccessDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'listByEvent'>
  readonly clock: Clock
}

export type GetRsvpForm = (input: GetRsvpFormInput) => Promise<Result<RsvpFormView, DomainError>>

/** The view of an opened event: what every use case of the settings answers with. */
export const rsvpFormViewOf = async (
  opened: OpenedRsvps,
  rsvps: Pick<GuestRsvpRepository, 'listByEvent'>,
  now: Date,
): Promise<RsvpFormView> => {
  const held = await rsvps.listByEvent(opened.event.id)
  return { ...opened, ...statsAndSituation(opened, held, now).situation }
}

export const makeGetRsvpForm =
  (deps: GetRsvpFormDeps): GetRsvpForm =>
  async ({ eventId, actorId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'read')
    if (!opened.ok) return opened
    return ok(await rsvpFormViewOf(opened.value, deps.rsvps, deps.clock.now()))
  }
