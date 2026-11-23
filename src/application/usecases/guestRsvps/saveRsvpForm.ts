import { questionIdFromBytes } from '../../../domain/guestRsvps/rsvpFormExtras'
import { scheduleOf } from '../../../domain/guestInvites/inviteStateOf'
import {
  applySettingsPatch,
  type RsvpSettings,
  type RsvpSettingsPatch,
} from '../../../domain/guestRsvps/rsvpSettings'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { IdGenerator } from '../../ports/idGenerator'
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
 * The owner saves what they ask guests (spec 30): the switch, the deadline, the form. **An absent
 * field is left as it was**; the domain judges every field, one code each.
 *
 * Needs the invitation (`409 rsvp.inviteRequired`): the settings live on its row and the deadline
 * is read in its zone. Writes the settings only (`saveRsvpSettings`): never the invitation's text,
 * its token, and **never the manual closing**, which has its own door. A save that changes nothing
 * writes, audits and announces nothing.
 */

export interface SaveRsvpFormInput extends RsvpSettingsPatch {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface SaveRsvpFormDeps extends RsvpAccessDeps {
  readonly invites: Pick<
    GuestInviteRepository,
    'findByEvent' | 'findRsvpSettings' | 'saveRsvpSettings'
  >
  readonly rsvps: Pick<GuestRsvpRepository, 'listByEvent' | 'clearShownNames'>
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly clock: Clock
  /** Draws the stable id of a question the host adds. */
  readonly ids: Pick<IdGenerator, 'bytes'>
}

export type SaveRsvpForm = (input: SaveRsvpFormInput) => Promise<Result<RsvpFormView, DomainError>>

const same = (a: RsvpSettings, b: RsvpSettings): boolean =>
  a.enabled === b.enabled &&
  a.deadline === b.deadline &&
  JSON.stringify(a.form) === JSON.stringify(b.form)

export const makeSaveRsvpForm =
  (deps: SaveRsvpFormDeps): SaveRsvpForm =>
  async ({ eventId, actorId, ...patch }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    const needed = requireInvite(opened.value)
    if (!needed.ok) return needed
    const { event, invite, settings } = needed.value
    const now = deps.clock.now()

    const saved = applySettingsPatch(settings, patch, scheduleOf(invite), () =>
      questionIdFromBytes(deps.ids.bytes(4)),
    )
    if (!saved.ok) return saved
    if (!same(saved.value, settings)) {
      const recorded = await recordRsvpAct(deps.audit, event, actorId, 'event.rsvpFormSaved', now)
      if (!recorded.ok) return recorded
      await deps.invites.saveRsvpSettings(eventId, saved.value)
      // Showing first names stops: every tick is withdrawn with it, so no guest finds themselves
      // named when it comes back by a choice they could not take back meanwhile.
      if (settings.form.visibility === 'names' && saved.value.form.visibility !== 'names') {
        await deps.rsvps.clearShownNames(eventId)
      }
      announceRsvpsChanged(deps.bus, eventId)
    }
    return ok(await rsvpFormViewOf({ ...needed.value, settings: saved.value }, deps.rsvps, now))
  }
