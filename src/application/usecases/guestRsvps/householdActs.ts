import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestHouseholdId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import {
  hostHouseholdOf,
  householdNotFound,
  mintHouseholdToken,
  type HostHousehold,
} from './householdAccess'
import { announceRsvpsChanged, openRsvps, recordRsvpAct, type RsvpAccessDeps } from './rsvpAccess'

/**
 * The two small acts on a household that is already listed (spec 30, lot 3):
 *
 * - **"Changer le lien"** (`rotateHouseholdToken`): a new token, **the old link stops at once**
 *   (and so does a card printed with it). The reply, the name, the places and the note stay.
 *   Audited without a name, before the change (`event.householdTokenRotated`).
 * - **"Relancé"** (`markHouseholdReminded`): the host's own note that they reminded the household,
 *   from their own apps; EventSlide sends nothing. Not audited.
 *
 * Both: the owner's door, refused on an archived event, `404 household.notFound` for one that is
 * not this event's or is gone, announced.
 */

export interface HouseholdActInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly householdId: GuestHouseholdId
}

export interface HouseholdActDeps extends RsvpAccessDeps {
  readonly households: Pick<GuestHouseholdRepository, 'findById' | 'rotateToken' | 'markReminded'>
  readonly rsvps: Pick<GuestRsvpRepository, 'findByHousehold'>
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type HouseholdAct = (input: HouseholdActInput) => Promise<Result<HostHousehold, DomainError>>
export type RotateHouseholdToken = HouseholdAct
export type MarkHouseholdReminded = HouseholdAct

export const makeRotateHouseholdToken =
  (deps: HouseholdActDeps): RotateHouseholdToken =>
  async ({ eventId, actorId, householdId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const held = await deps.households.findById(eventId, householdId)
    if (held === null) return err(householdNotFound())
    const token = mintHouseholdToken(deps.ids)
    if (!token.ok) return token
    const now = deps.clock.now()
    const recorded = await recordRsvpAct(
      deps.audit,
      opened.value.event,
      actorId,
      'event.householdTokenRotated',
      now,
    )
    if (!recorded.ok) return recorded
    if (!(await deps.households.rotateToken(eventId, householdId, token.value, now))) {
      return err(householdNotFound())
    }
    announceRsvpsChanged(deps.bus, eventId)
    return ok(await hostHouseholdOf(deps.rsvps, held.withToken(token.value, now)))
  }

export const makeMarkHouseholdReminded =
  (deps: HouseholdActDeps): MarkHouseholdReminded =>
  async ({ eventId, actorId, householdId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const held = await deps.households.findById(eventId, householdId)
    if (held === null) return err(householdNotFound())
    const now = deps.clock.now()
    if (!(await deps.households.markReminded(eventId, householdId, now))) {
      return err(householdNotFound())
    }
    announceRsvpsChanged(deps.bus, eventId)
    return ok(await hostHouseholdOf(deps.rsvps, held.withReminder(now)))
  }
