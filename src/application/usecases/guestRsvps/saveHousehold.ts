import {
  GuestHousehold,
  parseHouseholdInput,
  type RawHouseholdInput,
} from '../../../domain/guestRsvps/household'
import { parseHouseholdMoments } from '../../../domain/guestRsvps/rsvpFormMoments'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestHouseholdId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import {
  hostHouseholdOf,
  householdNotFound,
  householdsTooMany,
  mintHouseholdToken,
  type HostHousehold,
} from './householdAccess'
import { announceRsvpsChanged, openRsvps, requireInvite, type RsvpAccessDeps } from './rsvpAccess'

/**
 * The host adds a household to the guest list, or changes one's name and places (spec 30, lot 3):
 * one use case, the household's id decides which (absent: a new one with its own link).
 *
 * - judged by the domain (a name of 1 to 80 characters, 1 to 10 places);
 * - **a new household needs the invitation** (its link points at it): `409 rsvp.inviteRequired`;
 * - at most 500 per event, decided inside the repository's write (`409 household.tooMany`);
 * - **the moments it is invited to** (lot 4): `null` for all (the default), else 1 to 4 ids of the
 *   form's moments (`400 household.momentsInvalid`); absent on a change, they stay as they were;
 * - a change keeps the link, the reminder note and the reply: lowering the places does not touch
 *   a reply already given;
 * - refused on an archived event, like every write; not audited (the list is the host's own
 *   filing, and an import or a deletion has its line); announced (`rsvp.changed`).
 */

export interface SaveHouseholdInput extends RawHouseholdInput {
  readonly eventId: EventId
  readonly actorId: UserId
  /** Absent for a new household. */
  readonly householdId?: GuestHouseholdId
  /** `null`: all the form's moments; absent: unchanged (all, for a new household). */
  readonly moments?: unknown
}

export interface SaveHouseholdDeps extends RsvpAccessDeps {
  readonly households: Pick<GuestHouseholdRepository, 'addAll' | 'findById' | 'update'>
  readonly rsvps: Pick<GuestRsvpRepository, 'findByHousehold'>
  readonly bus: EventBus
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type SaveHousehold = (
  input: SaveHouseholdInput,
) => Promise<Result<HostHousehold, DomainError>>

export const makeSaveHousehold =
  (deps: SaveHouseholdDeps): SaveHousehold =>
  async ({ eventId, actorId, householdId, moments: rawMoments, ...raw }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const judged = parseHouseholdInput(raw)
    if (!judged.ok) return judged
    const moments =
      rawMoments === undefined
        ? ok(undefined)
        : parseHouseholdMoments(rawMoments, opened.value.settings.form.moments)
    if (!moments.ok) return moments
    const now = deps.clock.now()

    if (householdId === undefined) {
      const needed = requireInvite(opened.value)
      if (!needed.ok) return needed
      const token = mintHouseholdToken(deps.ids)
      if (!token.ok) return token
      const created = GuestHousehold.create({
        id: deps.ids.guestHouseholdId(),
        eventId,
        token: token.value,
        household: judged.value,
        moments: moments.value,
        now,
      })
      if (!(await deps.households.addAll(eventId, [created]))) return err(householdsTooMany())
      announceRsvpsChanged(deps.bus, eventId)
      return ok({ household: created, reply: null })
    }

    const held = await deps.households.findById(eventId, householdId)
    if (held === null) return err(householdNotFound())
    const changed = held.withInput(judged.value, now, moments.value)
    // A household deleted between the read and here: nothing was changed, so nothing is said.
    if (!(await deps.households.update(changed))) return err(householdNotFound())
    announceRsvpsChanged(deps.bus, eventId)
    return ok(await hostHouseholdOf(deps.rsvps, changed))
  }
