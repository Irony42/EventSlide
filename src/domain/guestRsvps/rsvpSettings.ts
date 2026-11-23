import type { InviteSchedule } from '../guestInvites/inviteStateOf'
import { DomainError } from '../shared/errors'
import { isCalendarDay, localDayOf } from '../shared/localDay'
import { err, ok, type Result } from '../shared/result'
import { applyFormPatch, DEFAULT_RSVP_FORM, type RsvpForm } from './rsvpForm'

/**
 * What the host decided about replies on an invitation (spec 30): whether they are asked, until
 * which day, whether the host closed them by hand, and the form. Stored on the invitation's row.
 */
export interface RsvpSettings {
  readonly enabled: boolean
  /** A local day, `YYYY-MM-DD`, read in the invitation's own zone. */
  readonly deadline: string | null
  readonly closedAt: Date | null
  readonly form: RsvpForm
}

export const DEFAULT_RSVP_SETTINGS: RsvpSettings = {
  enabled: false,
  deadline: null,
  closedAt: null,
  form: DEFAULT_RSVP_FORM,
}

export interface RsvpSettingsPatch {
  readonly enabled?: unknown
  readonly deadline?: unknown
  readonly form?: unknown
}

/**
 * The deadline, judged against the invitation it belongs to: a real day, and **not after the day
 * the party starts** in the zone the party is read in. `null` clears it. Changing the zone or the
 * start later does not rewrite a stored deadline (`rsvpStateOf` also stops at the start).
 */
const parseDeadline = (
  raw: unknown,
  schedule: InviteSchedule | null,
): Result<string | null, DomainError> => {
  if (raw === null) return ok(null)
  if (!isCalendarDay(raw)) return err(DomainError.invalid('rsvp.deadlineInvalid'))
  if (schedule === null) return err(DomainError.invalid('rsvp.deadlineNeedsDate'))
  if (raw > localDayOf(schedule.startsAt, schedule.timeZone)) {
    return err(DomainError.invalid('rsvp.deadlineAfterStart'))
  }
  return ok(raw)
}

/** `current` with a host's save applied. An absent field is left as it was; `null` clears a deadline. */
export const applySettingsPatch = (
  current: RsvpSettings,
  patch: RsvpSettingsPatch,
  schedule: InviteSchedule | null,
  mintQuestionId: () => string,
): Result<RsvpSettings, DomainError> => {
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') {
    return err(DomainError.invalid('rsvp.enabledInvalid'))
  }
  const deadline =
    patch.deadline === undefined ? ok(current.deadline) : parseDeadline(patch.deadline, schedule)
  if (!deadline.ok) return deadline
  const form =
    patch.form === undefined
      ? ok(current.form)
      : applyFormPatch(current.form, patch.form, mintQuestionId)
  if (!form.ok) return form
  return ok({
    ...current,
    enabled: patch.enabled ?? current.enabled,
    deadline: deadline.value,
    form: form.value,
  })
}

/** Closes replies by hand. Closing twice keeps the first moment. */
export const closeRsvps = (settings: RsvpSettings, at: Date): RsvpSettings => ({
  ...settings,
  closedAt: settings.closedAt ?? at,
})

export const reopenRsvps = (settings: RsvpSettings): RsvpSettings => ({
  ...settings,
  closedAt: null,
})
