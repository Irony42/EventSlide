import type { Event } from '../../../domain/events/event'
import type { GuestInvite } from '../../../domain/guestInvites/guestInvite'
import type { GuestRsvp } from '../../../domain/guestRsvps/rsvp'
import type { RsvpSettings } from '../../../domain/guestRsvps/rsvpSettings'
import type { RsvpStats } from '../../../domain/guestRsvps/rsvpStats'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import { openRsvps, statsAndSituation, type RsvpAccessDeps, type RsvpSituation } from './rsvpAccess'

/**
 * The host's replies page (spec 30): every reply, the figures (one function for the table, the
 * phone and the export), how many the host has not seen yet, and the date the replies will be
 * erased. Reading marks nothing as seen (`markRsvpsSeen` does).
 */

export interface ListRsvpsInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface RsvpList extends RsvpSituation {
  readonly event: Event
  readonly invite: GuestInvite | null
  readonly settings: RsvpSettings
  readonly rsvps: readonly GuestRsvp[]
  readonly stats: RsvpStats
  readonly unseen: number
}

export interface ListRsvpsDeps extends RsvpAccessDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'listByEvent' | 'unseenCount'>
  readonly clock: Clock
}

export type ListRsvps = (input: ListRsvpsInput) => Promise<Result<RsvpList, DomainError>>

export const makeListRsvps =
  (deps: ListRsvpsDeps): ListRsvps =>
  async ({ eventId, actorId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'read')
    if (!opened.ok) return opened
    const rsvps = await deps.rsvps.listByEvent(eventId)
    const { stats, situation } = statsAndSituation(opened.value, rsvps, deps.clock.now())
    return ok({
      ...opened.value,
      ...situation,
      rsvps,
      stats,
      unseen: await deps.rsvps.unseenCount(eventId, actorId),
    })
  }
