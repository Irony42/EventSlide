import { rsvpCsv, type RsvpCsvView } from '../../../domain/guestRsvps/rsvpCsv'
import { RSVP_CSV_LABELS } from '../../../domain/guestRsvps/rsvpCsvLabels'
import { DEFAULT_EVENT_LANGUAGE } from '../../../domain/events/eventLanguage'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import { openRsvps, recordRsvpAct, type RsvpAccessDeps } from './rsvpAccess'

/**
 * The replies as a spreadsheet (spec 30, section 4.5): `all` for the host, `caterer` for whoever
 * cooks (the people who come, no word). Written in the language of the invitation. Audited
 * (`event.rsvpsExported`: the file holds names and diets), once the file is made. Allowed on a
 * closed event, a read like any other.
 */

export interface ExportRsvpsInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly view: RsvpCsvView
}

export interface ExportedRsvps {
  readonly csv: string
  /** For the file name: the event's slug. */
  readonly slug: string
}

export interface ExportRsvpsDeps extends RsvpAccessDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'listByEvent'>
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type ExportRsvps = (input: ExportRsvpsInput) => Promise<Result<ExportedRsvps, DomainError>>

export const makeExportRsvps =
  (deps: ExportRsvpsDeps): ExportRsvps =>
  async ({ eventId, actorId, view }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'read')
    if (!opened.ok) return opened
    const { event, invite, settings } = opened.value

    const rsvps = await deps.rsvps.listByEvent(eventId)
    const labels = RSVP_CSV_LABELS[invite?.content.language ?? DEFAULT_EVENT_LANGUAGE]
    const recorded = await recordRsvpAct(
      deps.audit,
      event,
      actorId,
      'event.rsvpsExported',
      deps.clock.now(),
    )
    if (!recorded.ok) return recorded
    return ok({
      csv: rsvpCsv(rsvps, view, labels, settings.form.questions, {
        meals: settings.form.meals.enabled,
        diet: settings.form.diet,
      }, settings.form.moments),
      slug: event.slug.value,
    })
  }
