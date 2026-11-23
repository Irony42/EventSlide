import { GuestHousehold, MAX_HOUSEHOLDS_PER_EVENT } from '../../../domain/guestRsvps/household'
import {
  parseHouseholdList,
  type SkippedHouseholdLine,
} from '../../../domain/guestRsvps/householdImport'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import { householdsTooMany, mintHouseholdToken } from './householdAccess'
import {
  announceRsvpsChanged,
  openRsvps,
  recordRsvpAct,
  requireInvite,
  type RsvpAccessDeps,
} from './rsvpAccess'

/**
 * "Coller une liste" (spec 30, lot 3): the host pastes one household per line, `Nom ; places`,
 * 300 lines at most (`400 household.importTooLong`). What cannot be read is **skipped and
 * reported** (line number and reason), never guessed; a name already listed is skipped as a
 * duplicate without regard to case and accents.
 *
 * - needs the invitation (`409 rsvp.inviteRequired`) and an event that is not archived;
 * - **all or none**: the 500-household ceiling is decided inside the write (`409 household.tooMany`),
 *   and checked first from a count (a cheap early refusal);
 * - every household gets its own link token; the paste's order is the list's order;
 * - audited once, without any name (`event.householdsImported`), **after** the write succeeded, so a
 *   refusal (the ceiling reached between the count and the write) leaves no line; a log that refuses
 *   the line takes the households back, as `hostAddRsvp` takes a reply back; announced. A paste with nothing to add writes, audits and announces nothing.
 */

export interface ImportHouseholdsInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly text: unknown
}

export interface ImportedHouseholds {
  readonly households: readonly GuestHousehold[]
  readonly skipped: readonly SkippedHouseholdLine[]
}

export interface ImportHouseholdsDeps extends RsvpAccessDeps {
  readonly households: Pick<GuestHouseholdRepository, 'listByEvent' | 'addAll' | 'delete'>
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly ids: IdGenerator
  readonly clock: Clock
}

export type ImportHouseholds = (
  input: ImportHouseholdsInput,
) => Promise<Result<ImportedHouseholds, DomainError>>

export const makeImportHouseholds =
  (deps: ImportHouseholdsDeps): ImportHouseholds =>
  async ({ eventId, actorId, text }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const needed = requireInvite(opened.value)
    if (!needed.ok) return needed

    const listed = await deps.households.listByEvent(eventId)
    const parsed = parseHouseholdList(
      text,
      listed.map((household) => household.name),
    )
    if (!parsed.ok) return parsed
    const { skipped } = parsed.value
    if (parsed.value.households.length === 0) return ok({ households: [], skipped })
    if (listed.length + parsed.value.households.length > MAX_HOUSEHOLDS_PER_EVENT) {
      return err(householdsTooMany())
    }

    const now = deps.clock.now()
    const created: GuestHousehold[] = []
    for (const household of parsed.value.households) {
      const token = mintHouseholdToken(deps.ids)
      if (!token.ok) return token
      created.push(
        GuestHousehold.create({
          id: deps.ids.guestHouseholdId(),
          eventId,
          token: token.value,
          household,
          now,
        }),
      )
    }

    if (!(await deps.households.addAll(eventId, created))) return err(householdsTooMany())
    const recorded = await recordRsvpAct(
      deps.audit,
      needed.value.event,
      actorId,
      'event.householdsImported',
      now,
    )
    if (!recorded.ok) {
      // A log that refuses the line means no act: the households are taken back.
      for (const household of created) await deps.households.delete(eventId, household.id)
      return recorded
    }
    announceRsvpsChanged(deps.bus, eventId)
    return ok({ households: created, skipped })
  }
